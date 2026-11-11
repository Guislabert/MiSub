/**
 * 把模板里 `include-all-proxies: true` 的 select 组展开成显式节点名列表。
 *
 * 为什么需要：
 *   mihomo 对 `include-all-proxies: true` 的组走 config.go:892 的
 *   `slices.Sort(AllProxies)` —— 按节点名**字节序**重排，与模板里
 *   `proxies:` 段的声明顺序无关。国旗 emoji 的 UTF-8 首字节是 0xF0，
 *   ASCII 字母是 0x41，所以 `🇺🇸US-A100-...` 这类名字会先按国旗码位分组，
 *   机型根本不参与第一轮比较，客户端代理页因此显示 E500 开头而不是 A100。
 *
 *   显式列名走另一条路径（adapter/outboundgroup/parser.go:134 的
 *   getProxies），严格按列表顺序输出，不排序 —— 顺序完全可控。
 *
 * 为什么不直接写死在模板里：
 *   各 profile 的节点集合不同（有的只有 A100，有的全量）。模板硬编码全量
 *   节点名时，缺某系列的 profile 会报 `proxy group xxx: <节点名> not found`
 *   并 fatal 启动失败。所以必须在渲染时按当前 profile 实际拥有的节点动态展开。
 *
 * 为什么只展开 select：
 *   load-balance / url-test / fallback 组需要全量节点做测速，顺序无关，
 *   保留 `include-all-proxies` 更省事，也避免节点很多时 YAML 膨胀。
 */

/** 需要展开为显式列名的组类型（仅 select，理由见文件头） */
const EXPAND_TYPES = new Set(['select']);

/** 内置策略名，不参与节点展开 */
const BUILTIN_POLICIES = new Set([
    'DIRECT',
    'REJECT',
    'REJECT-DROP',
    'PASS',
    'COMPATIBLE',
    'GLOBAL',
]);

/**
 * 判断某个组是否应该展开。
 * @param {Object} group - proxy-group 定义
 * @returns {boolean}
 */
function shouldExpandGroup(group) {
    if (!group || typeof group !== 'object') return false;
    // 只有显式开启 include-all-proxies 的才处理
    if (group['include-all-proxies'] !== true) return false;
    const type = String(group.type || '').toLowerCase();
    return EXPAND_TYPES.has(type);
}

/**
 * 用 filter 正则筛选节点名。
 * @param {string[]} names - 全部节点名
 * @param {string} filter - mihomo filter 语法，反引号分隔多个正则
 * @returns {string[]}
 */
function applyFilter(names, filter) {
    if (!filter || typeof filter !== 'string') return names;
    const patterns = filter
        .split('`')
        .map((p) => p.trim())
        .filter(Boolean);
    if (patterns.length === 0) return names;

    const regexes = [];
    for (const pattern of patterns) {
        try {
            regexes.push(new RegExp(pattern, 'u'));
        } catch {
            // 非法正则直接忽略，避免整份订阅渲染失败
            continue;
        }
    }
    if (regexes.length === 0) return names;

    return names.filter((name) => regexes.some((re) => re.test(name)));
}

/**
 * 用 exclude-filter 正则剔除节点名。
 * @param {string[]} names
 * @param {string} excludeFilter
 * @returns {string[]}
 */
function applyExcludeFilter(names, excludeFilter) {
    if (!excludeFilter || typeof excludeFilter !== 'string') return names;
    const patterns = excludeFilter
        .split('`')
        .map((p) => p.trim())
        .filter(Boolean);
    if (patterns.length === 0) return names;

    const regexes = [];
    for (const pattern of patterns) {
        try {
            regexes.push(new RegExp(pattern, 'u'));
        } catch {
            continue;
        }
    }
    if (regexes.length === 0) return names;

    return names.filter((name) => !regexes.some((re) => re.test(name)));
}

/**
 * 把 proxy-groups 里 select 组的 include-all-proxies 展开成显式 proxies 列表。
 *
 * 展开后：
 *   - 保留组里原有的显式项（如 ♾️Auto Select / DIRECT / REJECT）
 *   - 追加当前 profile 实际拥有的节点名，顺序沿用 proxies 段顺序
 *   - 移除 include-all-proxies 标记，避免 mihomo 再次按字节序重排
 *
 * @param {Object} config - 已解析的 Clash 配置对象（会被就地修改）
 * @param {Object} options
 * @param {string[]} options.nodeNames - 当前 profile 的节点名列表（已按期望顺序排好）
 * @returns {{expanded: number, skipped: number}}
 */
export function expandIncludeAllProxies(config, options = {}) {
    const nodeNames = Array.isArray(options.nodeNames) ? options.nodeNames.filter(Boolean) : [];
    const groups = config?.['proxy-groups'];
    if (!Array.isArray(groups) || nodeNames.length === 0) {
        return { expanded: 0, skipped: 0 };
    }

    const nodeSet = new Set(nodeNames);
    let expanded = 0;
    let skipped = 0;

    for (const group of groups) {
        if (!shouldExpandGroup(group)) {
            skipped += 1;
            continue;
        }

        // 先按 filter / exclude-filter 筛选
        let candidates = applyFilter(nodeNames, group.filter);
        candidates = applyExcludeFilter(candidates, group['exclude-filter']);

        // 保留组里已有的显式项（组引用、DIRECT/REJECT 等），去掉重复
        const explicit = Array.isArray(group.proxies) ? group.proxies : [];
        const explicitSet = new Set(explicit.filter((item) => typeof item === 'string'));

        // 追加节点名：只加当前 profile 真实存在的，避免 not found
        const appended = [];
        for (const name of candidates) {
            if (!nodeSet.has(name)) continue;
            if (explicitSet.has(name)) continue;
            if (BUILTIN_POLICIES.has(name)) continue;
            appended.push(name);
            explicitSet.add(name);
        }

        group.proxies = [...explicit, ...appended];
        delete group['include-all-proxies'];
        delete group['include-all'];

        // filter 已生效，移除避免 mihomo 再做一次
        delete group.filter;
        delete group['exclude-filter'];

        expanded += 1;
    }

    return { expanded, skipped };
}

export const __test__ = {
    shouldExpandGroup,
    applyFilter,
    applyExcludeFilter,
    EXPAND_TYPES,
    BUILTIN_POLICIES,
};
