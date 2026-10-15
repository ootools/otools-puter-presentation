// @vitest-environment jsdom
/**
 * DOM 翻译层的边界。
 *
 * 只测机制，不测词条：跳过区、原文记忆、切语言可逆、属性翻译、漏译记录。
 */
import { beforeEach, describe, expect, it } from 'vitest';

import {
  disposeDomTranslation, domStats, installDomTranslation, missingStrings,
  resetMisses, setEnabled, translateAll,
} from '../src/otools/dom-i18n.js';
import { locale, registerCatalog, setPreference } from '../src/otools/i18n.js';

/** 挂一棵干净的树，装一个只认得几条词的假语言。 */
function mount(html) {
  document.body.innerHTML = html;
  registerCatalog(
    'zz-ZZ',
    {
      Save: '保存', Cancel: '取消', Open: '打开',
      // 表单控件占位符 / 版式提示语，用来测 placeholder 翻译与 SVG 提示翻译
      'Search presentations': '搜索演示文稿',
      'Click to add notes': '单击以添加备注',
    },
    [],
  );
  setPreference('zz-ZZ');
  resetMisses();
  disposeDomTranslation();
  installDomTranslation();
}

beforeEach(() => {
  window.localStorage.clear();
  document.body.innerHTML = '';
  disposeDomTranslation();
  setEnabled(true);
});

describe('文本翻译', () => {
  it('把叶子节点的文案换成译文', () => {
    mount('<div><button>Save</button></div>');
    expect(document.querySelector('button').textContent).toBe('保存');
  });

  it('保留首尾空白', () => {
    mount('<div><button>  Save  </button></div>');
    expect(document.querySelector('button').textContent).toBe('  保存  ');
  });

  it('没翻到的原文原样留着', () => {
    mount('<div><button>Nothing Here</button></div>');
    expect(document.querySelector('button').textContent).toBe('Nothing Here');
    expect(missingStrings()).toContain('Nothing Here');
  });

  it('只做整节点匹配，不做子串替换', () => {
    mount('<div><button>Save all files</button></div>');
    expect(document.querySelector('button').textContent).toBe('Save all files');
  });
});

describe('属性翻译', () => {
  it('title / aria-label 一起翻', () => {
    mount('<div><button title="Open" aria-label="Save">X</button></div>');
    const button = document.querySelector('button');
    expect(button.getAttribute('title')).toBe('打开');
    expect(button.getAttribute('aria-label')).toBe('保存');
  });
});

describe('切语言可逆', () => {
  it('切回原文语言时译文会还原，不会中文套中文', () => {
    mount('<div><button>Save</button></div>');
    expect(document.querySelector('button').textContent).toBe('保存');
    setPreference('en-US');
    translateAll();
    expect(document.querySelector('button').textContent).toBe('Save');
  });

  it('切到别的语言再切回来也还是原样', () => {
    mount('<div><button>Cancel</button></div>');
    setPreference('en-US');
    translateAll();
    setPreference('zz-ZZ');
    translateAll();
    expect(document.querySelector('button').textContent).toBe('取消');
  });

  it('反复切语言多次仍正确还原（MutationObserver 不再删掉英文原文）', async () => {
    // 复现「语言切换无效」：旧实现会在翻译层自己写入文本后，被 MutationObserver
    // 当成上游重渲染而删掉英文原文，导致再切回英文时无法还原。
    mount('<div><button>Save</button></div>');
    expect(document.querySelector('button').textContent).toBe('保存');
    // 等 install 触发的 MutationObserver 回调真正跑完（真实时序里它异步发生）
    await new Promise((resolve) => setTimeout(resolve, 30));
    setPreference('en-US'); translateAll();
    expect(document.querySelector('button').textContent).toBe('Save');
    setPreference('zz-ZZ'); translateAll();
    expect(document.querySelector('button').textContent).toBe('保存');
    setPreference('en-US'); translateAll();
    expect(document.querySelector('button').textContent).toBe('Save');
  });
});

describe('表单控件的展示属性', () => {
  it('INPUT / TEXTAREA 的 placeholder 仍会被翻译（内容不翻）', () => {
    mount(
      '<div>'
      + '<input placeholder="Search presentations" value="My notes">'
      + '<textarea placeholder="Click to add notes">User typed text</textarea>'
      + '</div>',
    );
    expect(document.querySelector('input').getAttribute('placeholder')).toBe('搜索演示文稿');
    expect(document.querySelector('textarea').getAttribute('placeholder')).toBe('单击以添加备注');
    // 用户内容（值 / 文本）绝不能被翻
    expect(document.querySelector('input').value).toBe('My notes');
    expect(document.querySelector('textarea').textContent).toBe('User typed text');
  });
});

describe('跳过区', () => {
  it('contenteditable 里的内容不动——那是用户写的', () => {
    mount('<div><p contenteditable>Save</p></div>');
    expect(document.querySelector('p').textContent).toBe('Save');
  });

  it('data-i18n-skip 标记的整棵子树不动', () => {
    mount('<div data-i18n-skip><span>Save</span></div>');
    expect(document.querySelector('span').textContent).toBe('Save');
  });

  it('code / pre 里的内容不动', () => {
    mount('<pre>Save</pre>');
    expect(document.querySelector('pre').textContent).toBe('Save');
  });

  it('跳过容器时，容器里别的界面文案照翻（只跳叶子，不跳整棵容器）', () => {
    // 父级是 contenteditable 的情况才会整棵跳过；普通容器不该连坐。
    mount('<div class="doc-card"><span class="doc-title">Save</span><button>Cancel</button></div>');
    expect(document.querySelector('button').textContent).toBe('取消');
  });
});

describe('动态内容', () => {
  it('新插入的节点也会被翻译', async () => {
    mount('<div id="host"></div>');
    const span = document.createElement('span');
    span.textContent = 'Open';
    document.getElementById('host').appendChild(span);
    translateAll();
    expect(span.textContent).toBe('打开');
  });
});

describe('统计', () => {
  it('domStats 报出当前语言与漏译条数', () => {
    mount('<div><button>Save</button><button>Nope</button></div>');
    const stats = domStats();
    expect(stats.locale).toBe(locale());
    expect(stats.missing).toBeGreaterThan(0);
  });

  it('关掉之后不再翻译', () => {
    setEnabled(false);
    mount('<div><button>Save</button></div>');
    expect(document.querySelector('button').textContent).toBe('Save');
  });
});
