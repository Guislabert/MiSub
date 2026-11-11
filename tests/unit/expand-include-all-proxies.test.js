import { describe, it, expect } from 'vitest';
import { expandIncludeAllProxies } from '../../functions/modules/subscription/expand-include-all-proxies.js';

const NODES = [
    '🇺🇸US-A100-AAA-BBB-01',
    '🇺🇸US-A100-AAA-BBB-02',
    '🇩🇪DE-C300-CCC-DDD-01',
    '🇩🇪DE-C300-CCC-DDD-02',
    '🇺🇸US-D400-EEE-FFF-01',
    '🇦🇺AU-E500-GGG-HHH-01',
    '🇭🇰HK-F600-III-JJJ-01',
];

const makeConfig = (groups) => ({ 'proxy-groups': groups, rules: ['MATCH,🌏️Main Proxy'] });

describe('expandIncludeAllProxies', () => {
    it('select 组的 include-all-proxies 展开成显式节点名', () => {
        const config = makeConfig([
            {
                name: '🌏️Main Proxy',
                type: 'select',
                'include-all-proxies': true,
                proxies: ['DIRECT', 'REJECT'],
            },
        ]);
        const r = expandIncludeAllProxies(config, { nodeNames: NODES });

        expect(r.expanded).toBe(1);
        const g = config['proxy-groups'][0];
        expect(g['include-all-proxies']).toBeUndefined();
        expect(g.proxies).toEqual(['DIRECT', 'REJECT', ...NODES]);
    });

    it('保留组内原有显式项，且不重复追加同名节点', () => {
        const config = makeConfig([
            {
                name: 'G',
                type: 'select',
                'include-all-proxies': true,
                proxies: ['DIRECT', NODES[0]],
            },
        ]);
        expandIncludeAllProxies(config, { nodeNames: NODES });
        const g = config['proxy-groups'][0];
        expect(g.proxies[0]).toBe('DIRECT');
        expect(g.proxies[1]).toBe(NODES[0]);
        expect(g.proxies.filter((x) => x === NODES[0])).toHaveLength(1);
    });

    it('load-balance / url-test / fallback 保留 include-all-proxies', () => {
        const config = makeConfig([
            { name: 'LB', type: 'load-balance', 'include-all-proxies': true },
            { name: 'UT', type: 'url-test', 'include-all-proxies': true },
            { name: 'FB', type: 'fallback', 'include-all-proxies': true },
        ]);
        const r = expandIncludeAllProxies(config, { nodeNames: NODES });

        expect(r.expanded).toBe(0);
        expect(r.skipped).toBe(3);
        for (const g of config['proxy-groups']) {
            expect(g['include-all-proxies']).toBe(true);
        }
    });

    it('未开启 include-all-proxies 的组不动', () => {
        const config = makeConfig([{ name: 'G', type: 'select', proxies: ['DIRECT'] }]);
        expandIncludeAllProxies(config, { nodeNames: NODES });
        expect(config['proxy-groups'][0].proxies).toEqual(['DIRECT']);
    });

    it('节点子集场景：只展开当前 profile 真实拥有的节点（不产生 not found）', () => {
        const subset = [NODES[0], NODES[1]]; // 只有 2 个 A100
        const config = makeConfig([
            { name: 'G', type: 'select', 'include-all-proxies': true, proxies: ['DIRECT'] },
        ]);
        expandIncludeAllProxies(config, { nodeNames: subset });
        const g = config['proxy-groups'][0];
        expect(g.proxies).toEqual(['DIRECT', ...subset]);
        // 关键：不包含其他 profile 才有的节点
        expect(g.proxies).not.toContain(NODES[2]);
    });

    it('filter 正则筛选后再展开', () => {
        const config = makeConfig([
            {
                name: 'AI',
                type: 'select',
                'include-all-proxies': true,
                filter: 'A100|C300',
                proxies: ['DIRECT'],
            },
        ]);
        expandIncludeAllProxies(config, { nodeNames: NODES });
        const g = config['proxy-groups'][0];
        expect(g.proxies).toEqual(['DIRECT', NODES[0], NODES[1], NODES[2], NODES[3]]);
        expect(g.filter).toBeUndefined();
    });

    it('exclude-filter 剔除后再展开', () => {
        const config = makeConfig([
            {
                name: 'G',
                type: 'select',
                'include-all-proxies': true,
                'exclude-filter': 'A100',
                proxies: ['DIRECT'],
            },
        ]);
        expandIncludeAllProxies(config, { nodeNames: NODES });
        const g = config['proxy-groups'][0];
        expect(g.proxies.some((x) => x.includes('A100'))).toBe(false);
        expect(g.proxies).toContain(NODES[2]);
    });

    it('非法 filter 正则被忽略，不抛错', () => {
        const config = makeConfig([
            {
                name: 'G',
                type: 'select',
                'include-all-proxies': true,
                filter: '([invalid',
                proxies: ['DIRECT'],
            },
        ]);
        expect(() => expandIncludeAllProxies(config, { nodeNames: NODES })).not.toThrow();
        expect(config['proxy-groups'][0].proxies).toEqual(['DIRECT', ...NODES]);
    });

    it('展开后顺序 == nodeNames 顺序（即 MiSub 算子链排序结果）', () => {
        const config = makeConfig([
            { name: 'G', type: 'select', 'include-all-proxies': true, proxies: [] },
        ]);
        expandIncludeAllProxies(config, { nodeNames: NODES });
        expect(config['proxy-groups'][0].proxies).toEqual(NODES);
    });

    it('空节点列表时不做任何修改', () => {
        const config = makeConfig([
            { name: 'G', type: 'select', 'include-all-proxies': true, proxies: ['DIRECT'] },
        ]);
        const r = expandIncludeAllProxies(config, { nodeNames: [] });
        expect(r.expanded).toBe(0);
        expect(config['proxy-groups'][0]['include-all-proxies']).toBe(true);
    });

    it('缺少 proxy-groups 时不抛错', () => {
        expect(() => expandIncludeAllProxies({}, { nodeNames: NODES })).not.toThrow();
        expect(() => expandIncludeAllProxies(null, { nodeNames: NODES })).not.toThrow();
    });

    it('include-all 简写也会被展开并移除', () => {
        const config = makeConfig([
            { name: 'G', type: 'select', 'include-all': true, proxies: ['DIRECT'] },
        ]);
        // include-all 不是 include-all-proxies，shouldExpandGroup 不命中
        const r = expandIncludeAllProxies(config, { nodeNames: NODES });
        expect(r.expanded).toBe(0);
    });
});
