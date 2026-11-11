import { describe, it, expect } from 'vitest';
import { addFlagEmoji } from '../../functions/utils/node-utils.js';

const NODE = 'trojan://pass@example.com:443#A100-US-DMC-LAX-01';

const nameOf = (link) => decodeURIComponent(link.split('#').pop());

describe('addFlagEmoji 分隔符', () => {
    it('默认空格：🇺🇸 A100-US-DMC-LAX-01', () => {
        expect(nameOf(addFlagEmoji(NODE))).toBe('🇺🇸 A100-US-DMC-LAX-01');
    });

    it('separator 未传时与旧行为一致（向后兼容）', () => {
        expect(nameOf(addFlagEmoji(NODE, {}))).toBe('🇺🇸 A100-US-DMC-LAX-01');
    });

    it("separator: '' 得到无空格形式：🇺🇸A100-US-DMC-LAX-01", () => {
        expect(nameOf(addFlagEmoji(NODE, { separator: '' }))).toBe('🇺🇸A100-US-DMC-LAX-01');
    });

    it('自定义分隔符', () => {
        expect(nameOf(addFlagEmoji(NODE, { separator: '-' }))).toBe('🇺🇸-A100-US-DMC-LAX-01');
    });

    it('名字已有 emoji 时不重复添加', () => {
        const withFlag = 'trojan://pass@example.com:443#🇺🇸A100-US-DMC-LAX-01';
        expect(nameOf(addFlagEmoji(withFlag, { separator: '' }))).toBe('🇺🇸A100-US-DMC-LAX-01');
    });

    it('无法识别具体国家时回退到地球 emoji，且分隔符同样生效', () => {
        const unknown = 'trojan://pass@example.com:443#unknown-node';
        expect(nameOf(addFlagEmoji(unknown, { separator: '' }))).toBe('🌍unknown-node');
        expect(nameOf(addFlagEmoji(unknown, { separator: ' ' }))).toBe('🌍 unknown-node');
    });

    it('separator 非字符串时回退到空格', () => {
        expect(nameOf(addFlagEmoji(NODE, { separator: null }))).toBe('🇺🇸 A100-US-DMC-LAX-01');
        expect(nameOf(addFlagEmoji(NODE, { separator: 123 }))).toBe('🇺🇸 A100-US-DMC-LAX-01');
    });

    it('空链接安全返回', () => {
        expect(addFlagEmoji('')).toBe('');
        expect(addFlagEmoji(null)).toBe(null);
    });
});
