// ============================================================================
// Content Script - 页面表单自动填充
// 融合自 ApplyEase 的表单识别和填充逻辑
// ============================================================================

(function() {
  'use strict';

  if (globalThis.__CAPYBARA_JOB_AUTOFILL_CONTENT_LOADED__) return;
  globalThis.__CAPYBARA_JOB_AUTOFILL_CONTENT_LOADED__ = true;

  // ========================================================================
  // 工具函数 - 从 ApplyEase 移植并改进
  // ========================================================================

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function dispatchInputEvents(element, value) {
    const valStr = String(value);
    if (element._valueTracker) {
      try { element._valueTracker.setValue(''); } catch {}
    }
    try {
      element.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        composed: true,
        data: valStr,
        inputType: 'insertFromPaste'
      }));
    } catch {
      element.dispatchEvent(new Event('input', { bubbles: true }));
    }
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function nativeSet(element, proto, value) {
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (element._valueTracker) {
      try { element._valueTracker.setValue(element.value); } catch {}
    }
    if (setter) setter.call(element, String(value));
    else element.value = String(value);
  }

  function matchSelectOption(select, value) {
    const valStr = String(value).trim();
    if (!valStr) return null;
    const opts = Array.from(select.options).filter((opt) => !opt.disabled && !opt.parentElement?.disabled);
    let matched = opts.find((opt) =>
      opt.value === valStr ||
      opt.text.trim() === valStr ||
      opt.value.toLowerCase() === valStr.toLowerCase() ||
      opt.text.trim().toLowerCase() === valStr.toLowerCase()
    );
    if (!matched && /^\d+$/.test(valStr)) {
      const num = parseInt(valStr, 10);
      matched = opts.find((opt) => [opt.value, opt.text.trim()].some((text) =>
        /^\d+[年月日]?$/.test(text) && parseInt(text, 10) === num));
    }
    if (!matched) {
      const candidates = opts.filter((opt) => {
        const t = opt.text.trim();
        return t === `${valStr}月` || t === `${valStr}年` || ({ 硕士: '硕士研究生', 博士: '博士研究生' })[valStr] === t;
      });
      if (candidates.length === 1) matched = candidates[0];
    }
    return matched;
  }

  function setValue(element, value) {
    if (!element || !element.isConnected || value === undefined || value === null) return false;
    const valStr = String(value);
    const tagName = element.tagName.toLowerCase();

    try { element.click(); } catch {}
    element.focus({ preventScroll: true });

    if (element.isContentEditable || element.getAttribute('contenteditable') === 'true') {
      try {
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(element);
        sel.removeAllRanges();
        sel.addRange(range);
      } catch {}
      const ok = document.execCommand && document.execCommand('insertText', false, valStr);
      if (!ok || !(element.textContent || '').length) element.textContent = valStr;
      dispatchInputEvents(element, valStr);
      return true;
    }

    if (tagName === 'select') {
      const matchedOpt = matchSelectOption(element, valStr);
      if (matchedOpt) {
        element.selectedIndex = matchedOpt.index;
        matchedOpt.selected = true;
        nativeSet(element, HTMLSelectElement.prototype, matchedOpt.value);
      } else return false;
      dispatchInputEvents(element, matchedOpt.value);
      return element.value === matchedOpt.value;
    }

    const proto = tagName === 'textarea' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    try {
      if (typeof element.select === 'function') element.select();
    } catch {}
    let inserted = false;
    try {
      inserted = !!(document.execCommand && document.execCommand('insertText', false, valStr));
    } catch {}
    if (!inserted || element.value !== valStr) {
      nativeSet(element, proto, valStr);
    }
    dispatchInputEvents(element, valStr);
    return element.value === valStr;
  }

  function optionTextEquals(text, value) {
    const t = String(text || '').replace(/\s+/g, '').trim();
    const v = String(value || '').replace(/\s+/g, '').trim();
    if (!t || !v) return false;
    if (t === v || t === `${v}年` || t === `${v}月` || t === `${v}日`) return true;
    if (/^\d+$/.test(v) && /^\d+[年月日]?$/.test(t) && parseInt(t, 10) === parseInt(v, 10)) return true;
    return false;
  }

  function isSelectWidget(el) {
    if (!el) return false;
    if (el.closest('.phoenix-select, [class*="sd-Select-container-"]')) return true;
    if (el.tagName === 'SELECT') return true;
    if (el.getAttribute('role') === 'combobox') return true;
    if (el.getAttribute('aria-haspopup') === 'listbox') return true;
    const wrap = el.closest('.ant-select, .el-select, .rc-select, .semi-select, .arco-select');
    return !!wrap;
  }

  function visibleDropdownRoot(el) {
    const ids = `${el.getAttribute('aria-controls') || ''} ${el.getAttribute('aria-owns') || ''}`.trim().split(/\s+/);
    for (const id of ids) {
      const owned = document.getElementById(id);
      if (owned && isElementTrulyVisible(owned)) return owned;
    }
    const nodes = document.querySelectorAll(
      '.ant-select-dropdown:not(.ant-select-dropdown-hidden), .el-select-dropdown, .rc-select-dropdown, .semi-select-option-list, .arco-select-popup, [role="listbox"]'
    );
    const visible = [...nodes].filter((d) => isElementTrulyVisible(d));
    return visible.length === 1 ? visible[0] : null;
  }

  function dropdownOptions(el) {
    const root = visibleDropdownRoot(el);
    if (!root) return [];
    return [...root.querySelectorAll('[role="option"], .ant-select-item-option, .el-select-dropdown__item, .semi-select-option, .arco-select-option')]
      .filter((option) => isElementTrulyVisible(option) && option.getAttribute('aria-disabled') !== 'true' &&
        !option.matches('.is-disabled, [disabled], [class*="option-disabled"]'));
  }

  async function fillSelectWidget(el, value) {
    const valStr = String(value ?? '').trim();
    if (!el || !valStr) return false;

    if (el.tagName === 'SELECT') return setValue(el, valStr);
    if (el.closest('[class*="sd-Select-container-"]')) return fillMokaSelect(el, valStr);

    const wrap = el.closest('.ant-select, .el-select, .rc-select, .semi-select, .arco-select') || el;
    const trigger = wrap.querySelector('.ant-select-selector, .el-input, .rc-select-selector, [class*="selector"]') || wrap;
    trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    trigger.click();
    await sleep(180);

    const selectedMatches = () => {
      const selected = wrap.querySelector('.ant-select-selection-item, .el-select__selected-item, .rc-select-selection-item, .semi-select-selection-text, .arco-select-view-value');
      return !!selected && optionTextEquals(selected.textContent, valStr);
    };
    const opts = dropdownOptions(el);
    const hit = opts.find((o) => optionTextEquals(o.textContent, valStr));
    if (hit) {
      hit.click();
      await sleep(60);
      return selectedMatches();
    }

    const search = wrap.querySelector('input') || (el.tagName === 'INPUT' ? el : null);
    if (search && !search.readOnly && !search.disabled) {
      setValue(search, valStr);
      await sleep(180);
      const opts2 = dropdownOptions(el);
      const exact = opts2.find((o) => optionTextEquals(o.textContent, valStr));
      const hit2 = exact;
      if (hit2) {
        hit2.click();
        await sleep(60);
        return selectedMatches();
      }
      nativeSet(search, HTMLInputElement.prototype, '');
      dispatchInputEvents(search, '');
    }

    document.body.click();
    return false;
  }

  function choiceCaption(el) {
    const parent = el.closest('label');
    if (parent) {
      const clone = parent.cloneNode(true);
      clone.querySelectorAll('input, textarea, select, svg').forEach((n) => n.remove());
      const text = clone.textContent.replace(/\s+/g, '').trim();
      if (text) return text;
    }
    const next = el.nextElementSibling;
    if (next) {
      const text = next.textContent.replace(/\s+/g, '').trim().slice(0, 16);
      if (text) return text;
    }
    return String(el.value || '').trim();
  }

  async function fillChoice(el, value) {
    const val = String(value || '').trim();
    if (!val) return false;
    if (el.type === 'checkbox') {
      const on = !/^(否|无|false|0|n)$/i.test(val);
      el.checked = on;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    const name = el.name;
    const group = name
      ? [...(el.form || el.getRootNode()).querySelectorAll(`input[type="radio"][name="${CSS.escape(name)}"]`)].filter((r) => r.form === el.form && !r.disabled)
      : [el];
    const hit = group.find((r) => {
      const cap = choiceCaption(r);
      return (cap && (cap === val || cap.split(/[，,、]/)[0] === val)) || String(r.value) === val;
    });
    if (!hit) return false;
    hit.click();
    return hit.checked;
  }

  function writableBox(el) {
    if (!el) return null;
    const tag = el.tagName.toLowerCase();
    if (tag === 'textarea' || tag === 'select') return el;
    if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') return el;
    if (tag === 'input') return el;
    const inner = el.querySelector && el.querySelector('textarea, [contenteditable="true"], input:not([type="hidden"])');
    return inner || el;
  }

  function valueWithinFieldLimit(el, value) {
    const text = String(value);
    const maxLength = parseInt(el.getAttribute('maxlength') || '0', 10);
    return maxLength > 0 && text.length > maxLength ? text.slice(0, maxLength) : text;
  }

  async function fillField(el, value) {
    if (!el || value === undefined || value === null || String(value).trim() === '') return false;
    const target = writableBox(el) || el;
    if (target.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
      markManual(target, `${value}（请确认具体日期）`); return false;
    }
    if (target.type === 'month' && /^\d{4}-\d{2}-\d{2}$/.test(String(value))) value = String(value).slice(0, 7);
    if (target.type === 'radio' || target.type === 'checkbox') return fillChoice(target, value);

    const valueToFill = valueWithinFieldLimit(target, value);
    if (isSelectWidget(target) || isYearControl(target) || isMonthControl(target)) {
      return fillSelectWidget(target, valueToFill);
    }
    if (target.readOnly || target.disabled) return false;
    return setValue(target, valueToFill);
  }

  const JUNK_LABEL_RE = /^(必填项未填写|必填|选填|请选择|请输入|\+?86|年|月|日|号|\d{1,4})$/;

  function cleanLabel(raw) {
    let text = String(raw || '').replace(/\s+/g, ' ').trim();
    text = text.replace(/[*＊]/g, '').replace(/（必填）|\(必填\)|必填项未填写/g, '').trim();
    if (!text || JUNK_LABEL_RE.test(text)) return '';
    if (text.length > 120) return '';
    return text.toLowerCase();
  }

  function getClosestLabelText(input) {
    try {
      const phoenix = input.closest('.form-item--phoenix');
      if (phoenix) return cleanLabel(phoenix.querySelector('.form-item__title')?.textContent);
      const mokaField = input.closest('[class*="apply-field-"]');
      if (isMokaForm() && mokaField) {
        return cleanLabel(mokaField.querySelector('[class^="title-"]')?.textContent);
      }
      const labelledBy = (input.getAttribute('aria-labelledby') || '').split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent || '').join(' ');
      const accessibleLabel = cleanLabel(labelledBy) || cleanLabel(input.getAttribute('aria-label'));
      if (accessibleLabel) return accessibleLabel;
      if (input.id) {
        const label = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
        const cleaned = cleanLabel(label && label.textContent);
        if (cleaned) return cleaned;
      }

      const parentLabel = input.closest('label');
      if (parentLabel) {
        const clone = parentLabel.cloneNode(true);
        clone.querySelectorAll('input, textarea, select, button').forEach((n) => n.remove());
        const cleaned = cleanLabel(clone.textContent);
        if (cleaned) return cleaned;
      }

      const item = input.closest(
        '.ant-form-item, .el-form-item, .semi-form-field, .arco-form-item, [class*="form-item"], [class*="FormItem"], [class*="formItem"], [class*="form-field"], [class*="field-item"], [class*="apply-item"]'
      );
      if (item) {
        const titleEl = item.querySelector('.ant-form-item-label, .el-form-item__label, label, [class*="form-item-label"], [class*="field-label"], [class*="form-label"]');
        const cleaned = cleanLabel(titleEl && titleEl.textContent);
        if (cleaned) return cleaned;
        const first = item.firstElementChild;
        const firstText = cleanLabel(first && first.textContent);
        if (firstText && first !== input && !first.contains(input)) return firstText;
      }

      let node = input;
      for (let i = 0; i < 4 && node; i++) {
        const prev = node.previousElementSibling;
        const cleaned = prev && !prev.matches('input, textarea, select, [role="combobox"]') &&
          !prev.querySelector('input, textarea, select, [role="combobox"]') && cleanLabel(prev.textContent);
        if (cleaned) return cleaned;
        node = node.parentElement;
      }

      const aria = cleanLabel(input.getAttribute('aria-label'));
      if (aria) return aria;
      const ph = cleanLabel(input.placeholder);
      if (ph) return ph;
      return '';
    } catch {
      return '';
    }
  }

  // 获取元素的所有识别特征
  function getElementFeatures(element) {
    const name = (element.name || '').toLowerCase();
    const id = (element.id || '').toLowerCase();
    const placeholder = (element.placeholder || '').toLowerCase();
    const label = getClosestLabelText(element);
    const className = (element.className || '').toLowerCase();

    return {
      name,
      id,
      placeholder,
      label,
      className,
      combined: `${name} ${id} ${placeholder} ${label} ${className}`
    };
  }

  // 字段匹配规则（中英文）
  const FIELD_PATTERNS = {
    // 姓名相关
    fullName: [
      /^(full[-_\s]?name|name|姓名|真实姓名|用户名称)$/i,
      /真实姓名|姓名/i
    ],
    firstName: [
      /^(first[-_\s]?name|given[-_\s]?name|名|firstname)$/i,
      /first|given|名字/i
    ],
    lastName: [
      /^(last[-_\s]?name|surname|family[-_\s]?name|姓|lastname)$/i,
      /last[-_\s]?name|surname|family[-_\s]?name|姓氏/i
    ],
    middleName: [
      /^(middle[-_\s]?name|middlename)$/i,
      /middle.*name/i
    ],

    // 联系方式
    phone: [
      /^(phone|mobile|tel|telephone|联系电话|手机|电话|contact)$/i,
      /phone|mobile|tel|电话|手机/i
    ],
    phoneType: [
      /^(phone[-_\s]?type)$/i,
      /phone.*type/i
    ],
    email: [
      /^(email|e[-_]?mail|邮箱|电子邮箱|mail)$/i,
      /email|mail|邮箱/i
    ],

    // 个人信息
    gender: [
      /^(gender|sex|性别)$/i,
      /gender|sex|性别/i
    ],
    birthDate: [
      /^(birth|birthday|birthdate|dob|出生日期|生日|date.*birth)$/i,
      /birth|生日|出生/i
    ],
    idCard: [
      /^(id[-_]?card|identity|身份证|证件号)$/i,
      /身份证|idcard|identity/i
    ],

    // 地址信息（详细拆分）
    street: [
      /^(street|address.*line|addr.*line|street.*addr|街道)$/i,
      /street|街道|address.*1/i
    ],
    city: [
      /^(city|城市)$/i,
      /city|城市/i
    ],
    state: [
      /^(state|province|region|州|省|地区)$/i,
      /state|province|region|州|省/i
    ],
    country: [
      /^(country|nation|国家)$/i,
      /country|国家/i
    ],
    zipCode: [
      /^(zip|postal|postcode|邮编|邮政编码)$/i,
      /zip|postal|邮编/i
    ],
    location: [
      /^(location|address|所在地|居住地)$/i,
      /location|地址|所在地/i
    ],

    // 社交链接
    linkedin: [
      /^(linkedin|linked[-_]?in)$/i,
      /linkedin/i
    ],
    github: [
      /^(github|git[-_]?hub)$/i,
      /github/i
    ],
    website: [
      /^(website|homepage|personal.*site|个人网站)$/i,
      /website|homepage|个人.*网站/i
    ],
    twitter: [
      /^(twitter|x\.com)$/i,
      /twitter/i
    ],

    // 政治面貌与身份背景
    politicalStatus: [
      /^(political|party|政治面貌|党派)$/i,
      /政治面貌|political.*status|党派/i
    ],
    ethnicity: [
      /^(ethnicity|ethnic|nation|民族)$/i,
      /民族|ethnicity/i
    ],
    hometown: [
      /^(hometown|native.*place|籍贯)$/i,
      /籍贯/i
    ],
    graduationDate: [
      /^(graduation|grad.*date|毕业时间|毕业年月|预计毕业)$/i,
      /毕业时间|毕业年月|预计毕业/i
    ],
    maritalStatus: [
      /^(marital|marriage|marital.*status|婚姻状况|婚姻|婚否)$/i,
      /婚姻状况|婚姻情况|marital/i
    ],
    currentCity: [
      /^(current.*city|present.*city|residence.*city|现居住地|现居城市|目前所在地|现所在城市|居住城市)$/i,
      /现居住地|现居城市|目前所在城市|现所在地/i
    ],

    // 紧急联系人
    emergencyContact: [
      /^(emergency.*contact|emergency.*name|紧急联系人|紧急联络人)$/i,
      /紧急联系人|紧急联络人/i
    ],
    emergencyRelation: [
      /^(emergency.*relation|relationship|与本人关系|关系)$/i,
      /紧急.*关系|与本人关系/i
    ],
    emergencyPhone: [
      /^(emergency.*phone|emergency.*tel|紧急联系电话|紧急联系人手机)$/i,
      /紧急.*电话|紧急.*手机/i
    ],

    // 求职意向
    expectedCity: [
      /^(expected.*city|target.*city|期望城市|意向城市|期望工作地|意向工作地点)$/i,
      /期望城市|意向城市|期望工作地点/i
    ],
    expectedPosition: [
      /^(expected.*position|target.*job|期望岗位|意向岗位|求职岗位|目标职位|应聘职位)$/i,
      /期望岗位|意向职位|求职意向|目标岗位|应聘职位/i
    ],
    expectedSalary: [
      /^(expected.*salary|salary|期望薪资|期望月薪|期望年薪|薪资要求)$/i,
      /期望薪资|期望月薪|薪资要求/i
    ],
    availableDate: [
      /^(available.*date|start.*work|到岗时间|入职时间|最快到岗)$/i,
      /到岗时间|最快到岗|入职时间/i
    ],
    referralCode: [
      /^(referral.*code|recommender|内推码|推荐码|推荐人|伯乐码)$/i,
      /内推码|推荐码|推荐人|伯乐码/i
    ],
    recruitSource: [
      /^(recruit.*source|source.*recruit|channel|信息来源|招聘渠道|获取渠道|获知渠道|渠道来源)$/i,
      /招聘渠道|信息来源|获知渠道|渠道来源/i
    ],
    willingToTravel: [
      /^(willing.*travel|travel|出差|驻外|接受出差|愿意出差|能否出差|可出差)$/i,
      /出差|驻外|接受.*异地/i
    ],

    // 语言能力
    cet4: [
      /^(cet[-_\s]?4|四级|英语四级|四级成绩)$/i,
      /四级|cet[-_\s]?4/i
    ],
    cet6: [
      /^(cet[-_\s]?6|六级|英语六级|六级成绩)$/i,
      /六级|cet[-_\s]?6/i
    ],
    ielts: [
      /^(ielts|雅思|雅思成绩)$/i,
      /ielts|雅思/i
    ],
    toefl: [
      /^(toefl|托福|托福成绩)$/i,
      /toefl|托福/i
    ],
    otherLanguages: [
      /^(other.*languages?|第二外语|其他外语|小语种|外语能力)$/i,
      /其他外语|第二外语|小语种|other.*language/i
    ],

    // 荣誉奖项
    awards: [
      /^(awards|honors|荣誉|奖项|获奖经历|竞赛获奖)$/i,
      /荣誉|奖项|获奖经历|竞赛/i
    ],
    certificates: [
      /^(certificates?|licenses?|资格证书|职业证书|证书名称|所获证书)$/i,
      /资格证书|职业证书|所获证书|certificate/i
    ],
    certificateCode: [
      /^(certificate.*(?:code|number|no)|证书编号|资格证编号)$/i,
      /证书.*编号|certificate.*(?:code|number)/i
    ],
    certificateIssuer: [
      /^(certificate.*issuer|issuing.*organization|颁发机构|发证机构)$/i,
      /颁发机构|发证机构|certificate.*issuer/i
    ],
    certificateDate: [
      /^(certificate.*date|issue.*date|取得日期|获证日期|发证日期)$/i,
      /证书.*日期|取得日期|发证日期/i
    ],
    certificateExpiryDate: [
      /^(certificate.*expir|expiry.*date|有效期至|证书有效期)$/i,
      /有效期至|证书.*有效期|certificate.*expir/i
    ],
    familyName: [
      /^(family.*name|member.*name|家庭成员姓名|家属姓名)$/i,
      /家庭成员.*姓名|家属姓名/i
    ],
    familyRelation: [
      /^(family.*relation|member.*relation|亲属关系|家庭成员关系)$/i,
      /亲属关系|家庭成员.*关系/i
    ],
    familyEmployer: [
      /^(family.*employer|member.*company|亲属工作单位|家庭成员工作单位)$/i,
      /亲属.*工作单位|家庭成员.*单位/i
    ],
    familyPosition: [
      /^(family.*position|member.*position|亲属职务|家庭成员职务)$/i,
      /亲属.*职务|家庭成员.*职务/i
    ],
    familyPhone: [
      /^(family.*phone|member.*phone|亲属联系电话|家庭成员电话)$/i,
      /亲属.*电话|家庭成员.*电话/i
    ],

    // 教育信息
    school: [
      /^(school|university|college|edu|学校|院校|毕业院校|毕业学校|最高学历院校)$/i,
      /school|university|college|学校|院校|毕业院校/i
    ],
    college: [
      /^(department|faculty|college.*name|学院|院系|所属学院)$/i,
      /学院|院系/i
    ],
    major: [
      /^(major|专业|所学专业|discipline|专业名称)$/i,
      /major|专业|学科|discipline/i
    ],
    degree: [
      /^(学历|education|edu.*level|最高学历)$/i,
      /学历|education/i
    ],
    degreeType: [
      /^(degree.*type|study.*type|培养方式|学习形式|学历类型|统招)$/i,
      /培养方式|学历类型|全日制/i
    ],
    schoolType: [
      /^(school.*type|college.*type|院校层次|学校类型|院校类别|学校层次)$/i,
      /院校层次|学校类型|院校类别|学校层次/i
    ],
    gpa: [
      /^(gpa|grade|score|绩点|成绩|平均分|平均绩点)$/i,
      /gpa|绩点|成绩/i
    ],
    rank: [
      /^(rank|ranking|排名|成绩排名|专业排名|班级排名)$/i,
      /专业排名|成绩排名|班级排名/i
    ],
    courses: [
      /^(courses|major.*courses|主修课程|核心课程|专业课程)$/i,
      /主修课程|核心课程|专业课/i
    ],
    educationDescription: [
      /^(education.*description|在校经历|在校描述|教育经历描述|在校表现)$/i,
      /在校经历|在校描述|教育经历描述|在校表现/i
    ],
    eduStartDate: [
      /^(edu.*start|入学时间|入学年份|在读开始|就读开始|教育开始)$/i,
      /入学时间|入学年月|在读开始|就读开始/i
    ],
    eduEndDate: [
      /^(edu.*end|毕业时间|预计毕业|在读结束|就读结束|教育结束)$/i,
      /毕业时间|预计毕业|在读结束|就读结束/i
    ],

    // 工作经验
    company: [
      /^(company|employer|org|公司|单位|工作单位|实习单位|公司名称|单位名称)$/i,
      /公司名称|单位名称|实习单位|工作单位/i
    ],
    department: [
      /^(dept|department|部门|所属部门|业务线|事业群)$/i,
      /所属部门|实习部门|业务线|事业群/i
    ],
    position: [
      /^(position|title|job|role|职位|岗位|职务|实习岗位|担任职位|职位名称)$/i,
      /职位名称|担任职位|实习岗位/i
    ],
    workCity: [
      /^(work.*city|job.*location|实习地点|工作城市|工作地点)$/i,
      /工作地点|实习地点|工作城市/i
    ],
    workStartDate: [
      /^(work.*start|job.*start|入职时间|入职年月|实习开始|工作开始)$/i,
      /入职时间|入职年月|实习开始|工作开始/i
    ],
    workEndDate: [
      /^(work.*end|job.*end|离职时间|离职年月|实习结束|工作结束)$/i,
      /离职时间|离职年月|实习结束|工作结束/i
    ],
    workDescription: [
      /^(work.*desc|job.*desc|工作内容|工作职责|实习职责|工作描述|主要工作|岗位职责)$/i,
      /工作内容|工作职责|工作描述|主要工作|岗位职责/i
    ],
    workAchievements: [
      /^(achievements|work.*output|工作成果|量化成果|实习产出|主要业绩|核心贡献)$/i,
      /工作成果|主要业绩|量化成果|核心贡献/i
    ],

    // 项目经验
    projectName: [
      /^(project.*name|proj.*name|项目名称|项目名|项目)$/i,
      /项目名称|项目名|project.*name/i
    ],
    projectRole: [
      /^(project.*role|proj.*role|担任角色|项目角色|项目中角色|项目职位|担任职位)$/i,
      /担任角色|项目角色|项目中角色|项目职位/i
    ],
    projectStartDate: [
      /^(project.*start|proj.*start|项目开始|项目起始|项目起止)$/i,
      /项目.*开始|项目.*起始|项目.*起止/i
    ],
    projectEndDate: [
      /^(project.*end|proj.*end|项目结束|项目截止)$/i,
      /项目.*结束|项目.*截止/i
    ],
    techStack: [
      /^(tech.*stack|technologies|技术栈|关键技术|使用技术|开发技术|核心技术|主要技术|所用技术|技术框架|工具栈)$/i,
      /技术栈|关键技术|开发技术|核心技术|使用技术|所用技术|技术框架/i
    ],
    projectUrl: [
      /^(project.*url|demo.*url|项目链接|作品链接|作品集链接|在线地址|GitHub地址|演示地址)$/i,
      /项目链接|作品集?链接|github.*url|在线地址/i
    ],
    projectResponsibilities: [
      /^(project.*resp|proj.*role|个人职责|项目职责|项目中职责|主要职责|主要工作|所任职责|负责内容|个人分工|承担职责|开发工作|工作职责|难点攻关)$/i,
      /个人职责|项目职责|项目中职责|主要职责|负责内容|个人分工|承担职责|主要工作|所任职责|开发工作|难点攻关/i
    ],
    projectAchievements: [
      /^(project.*achieve|项目成果|竞赛产出|项目业绩|主要成果|项目产出|量化成果|主要成效|达成成果)$/i,
      /项目成果|项目业绩|竞赛产出|量化成果|主要成果|项目产出|主要成效/i
    ],
    projectDescription: [
      /^(project.*desc|proj.*desc|项目描述|项目背景|项目简介|项目介绍|项目内容|项目概述|项目简述)$/i,
      /项目描述|项目背景|项目简介|项目介绍|项目内容|项目概述|项目简述/i
    ],

    // 技能
    skills: [
      /^(skill|技能|专业技能|特长)$/i,
      /skill|技能|特长/i
    ],

    // 自我介绍
    introduction: [
      /^(intro|self.*intro|个人简介|自我介绍|about)$/i,
      /intro|简介|自我介绍|about.*me/i
    ],

    // 简历上传
    resume: [
      /^(resume|cv|简历|附件)$/i,
      /resume|cv|简历|attachment/i
    ]
  };

  // ========================================================================
  // 输入框智能过滤与 HR 沟通框识别 (避免误填全站搜索框/登录框)
  // ========================================================================

  // 判断输入框是否应被忽略（排除全站搜索框、登录验证码框、密码框等）
  function isIgnoredInput(element) {
    if (!element) return true;
    if (element.disabled) return true;

    // 1. 悬浮窗或抽屉内部元素排除
    if (element.closest('#job-autofill-dock, #job-autofill-copy-panel, #job-autofill-ai-panel, #job-autofill-log-panel')) {
      return true;
    }

    const type = (element.type || '').toLowerCase();
    if (type === 'password' || type === 'hidden') return true;
    if (type === 'search' && !element.closest('.ant-select, .el-select, .rc-select, .semi-select, [class*="form-item"], [class*="form-field"]')) return true;

    // 3. 搜索栏与全局检索框（如 BOSS/智联/猎聘/全网导航搜索）
    if (element.closest('form[role="search"], .search-form, .search-box, .search-bar, .search-wrap, .search-panel, .header-search, .navbar-search, .global-search, .search-container, .top-search, .search-input-box')) {
      return true;
    }

    if (isProtectedQuestion(getClosestLabelText(element))) return true;
    const features = getElementFeatures(element);
    if (/^(query|keyword|keywords|kw|search_kw|search_key|search_input|q|searchword|searchinput)$/i.test(features.name) ||
        /^(query|keyword|keywords|kw|search_kw|search_key|search_input|q|searchword|searchinput)$/i.test(features.id)) {
      return true;
    }

    if (/(搜索职位|搜索公司|搜索岗位|搜索工作|搜职位|搜公司|搜人才|输入职位|输入公司|搜索全站|关键词搜索|请输入关键词|请输入搜索|站内搜索|输入岗位)/i.test(features.placeholder)) {
      return true;
    }

    // 4. 登录/注册/手机验证码（防误填登录弹窗）
    if (/(验证码|短信验证码|图形验证码|短信校验码|手机验证码|captcha|smscode|verifycode|vcode|authcode)/i.test(features.combined)) {
      return true;
    }
    if (element.closest('.login-modal, .login-dialog, .login-wrap, .login-box, .login-form, .signin-form, .auth-modal, .passport-login, #login-modal, #loginModal')) {
      return true;
    }

    return false;
  }

  // 查找页面上的 HR 沟通/聊天输入框（如 BOSS直聘、智联、猎聘、牛客聊天框）
  function findChatInputElement() {
    const selectors = [
      'div.chat-input[contenteditable="true"]',
      'div[contenteditable="true"].chat-editor',
      'div[contenteditable="true"].chat-message-input',
      'div[contenteditable="true"].boss-chat-editor',
      'div[contenteditable="true"].input-area',
      'div[contenteditable="true"][class*="chat"]',
      'div[contenteditable="true"][class*="editor"]',
      'div[contenteditable="true"][class*="message"]',
      '.chat-conversation textarea',
      '.chat-input textarea',
      '.chat-box textarea',
      '.chat-editor textarea',
      'textarea.chat-input',
      'textarea.chat-editor',
      'textarea[class*="chatInput"]',
      'textarea[class*="chat-message"]'
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.offsetParent !== null && !el.closest('#job-autofill-dock, #job-autofill-copy-panel, #job-autofill-ai-panel, #job-autofill-log-panel')) {
        return el;
      }
    }
    return null;
  }

  // 往聊天框填入文本（兼容 contenteditable 与 textarea）
  function setChatInputValue(element, text) {
    if (!element || !text) return false;
    element.focus();

    if (element.tagName.toLowerCase() === 'textarea' || element.tagName.toLowerCase() === 'input') {
      setValue(element, text);
    } else if (element.isContentEditable || element.getAttribute('contenteditable') === 'true') {
      element.innerHTML = '';
      const success = document.execCommand && document.execCommand('insertText', false, text);
      if (!success) {
        element.textContent = text;
      }
      ['input', 'change', 'blur'].forEach(eventType => {
        element.dispatchEvent(new Event(eventType, { bubbles: true }));
      });
    }
    return true;
  }

  // 生成个性化打招呼语
  function generateDefaultGreeting(profile, positionName, companyName) {
    const b = profile.basicInfo || {};
    const edu = (profile.education && profile.education[0]) || {};
    const name = b.fullName || '求职者';
    const school = edu.school ? `${edu.school}` : '';
    const major = edu.major ? `${edu.major}专业` : '';
    const pos = positionName || '贵司岗位';
    const comp = companyName || '贵公司';

    if (school && major) {
      return `您好！我是${name}，来自${school}${major}。看到${comp}正在招聘「${pos}」，我的背景与该岗位方向很契合，期待能与您沟通交流，谢谢！`;
    }
    return `您好！我是${name}，对${comp}的「${pos}」岗位非常感兴趣，期待能与您进一步沟通交流，谢谢！`;
  }

  // 智能拆解项目内容（将大段混合的 description 自动分解为背景概述、工作职责、成果产出、技术栈）
  function smartExtractProjectParts(project) {
    if (!project) return {};

    const rawDesc = String(project.description || '').trim();
    const rawResp = String(project.responsibilities || '').trim();
    const rawAchieve = String(project.achievements || '').trim();
    const rawTech = String(project.techStack || '').trim();
    const role = String(project.role || '').trim();

    // 如果各字段本来就是结构化填好的，直接使用
    if (rawResp && (rawDesc || rawAchieve || rawTech)) {
      return {
        description: rawDesc || rawResp,
        responsibilities: rawResp,
        achievements: rawAchieve,
        techStack: rawTech,
        role
      };
    }

    const fullText = [rawDesc, rawResp, rawAchieve].filter(Boolean).join('\n');
    if (!fullText) {
      return { description: '', responsibilities: '', achievements: '', techStack: rawTech, role };
    }

    const lines = fullText.split('\n').map(l => l.trim()).filter(Boolean);
    const descLines = [];
    const respLines = [];
    const achieveLines = [];
    const techLines = [];

    let currentSection = 'desc';

    for (const line of lines) {
      if (/^(项目描述|项目背景|项目简介|项目介绍|项目概述|背景|介绍)[：:]/i.test(line)) {
        currentSection = 'desc';
        const content = line.replace(/^(项目描述|项目背景|项目简介|项目介绍|项目概述|背景|介绍)[：:]/i, '').trim();
        if (content) descLines.push(content);
      } else if (/^(项目职责|项目中职责|个人职责|主要职责|职责|工作内容|负责内容|项目内容|主要工作|个人分工|担任角色)[：:]/i.test(line)) {
        currentSection = 'resp';
        const content = line.replace(/^(项目职责|项目中职责|个人职责|主要职责|职责|工作内容|负责内容|项目内容|主要工作|个人分工|担任角色)[：:]/i, '').trim();
        if (content) respLines.push(content);
      } else if (/^(项目成果|主要成果|项目业绩|量化成果|主要成效|成果|业绩)[：:]/i.test(line)) {
        currentSection = 'achieve';
        const content = line.replace(/^(项目成果|主要成果|项目业绩|量化成果|主要成效|成果|业绩)[：:]/i, '').trim();
        if (content) achieveLines.push(content);
      } else if (/^(技术栈|关键技术|使用技术|核心技术|开发技术|技术)[：:]/i.test(line)) {
        currentSection = 'tech';
        const content = line.replace(/^(技术栈|关键技术|使用技术|核心技术|开发技术|技术)[：:]/i, '').trim();
        if (content) techLines.push(content);
      } else if (/^[●•\-*]\s*(职责|负责|构建|设计|微调|开发|实现|重构|编写|主导|优化|搭建|处理|训练|部署|集成)/i.test(line) ||
                 /^(负责|主导|构建|设计|微调|开发|实现|编写|搭建|训练)/i.test(line)) {
        respLines.push(line);
      } else if (/[0-9]+%|降低[0-9]+|提升[0-9]+|并发|延迟|准确率|QPS|TPS|节省|产出|上线/i.test(line) && currentSection === 'achieve') {
        achieveLines.push(line);
      } else {
        if (currentSection === 'resp') respLines.push(line);
        else if (currentSection === 'achieve') achieveLines.push(line);
        else if (currentSection === 'tech') techLines.push(line);
        else descLines.push(line);
      }
    }

    const finalDesc = descLines.filter(Boolean).join('\n').trim() || (respLines.length ? descLines.join('\n').trim() : fullText);
    const finalResp = rawResp || respLines.filter(Boolean).join('\n').trim();
    const finalAchieve = rawAchieve || achieveLines.filter(Boolean).join('\n').trim();
    const finalTech = rawTech || techLines.filter(Boolean).join(', ').trim();

    return {
      description: finalDesc || fullText,
      responsibilities: finalResp,
      achievements: finalAchieve,
      techStack: finalTech,
      role
    };
  }

  // 智能拆解工作经历
  function smartExtractWorkParts(work) {
    if (!work) return {};
    const rawDesc = String(work.description || '').trim();
    const rawAchieve = String(work.achievements || '').trim();
    if (rawAchieve && rawDesc) return { description: rawDesc, achievements: rawAchieve };

    const lines = rawDesc.split('\n').map(l => l.trim()).filter(Boolean);
    const descLines = [];
    const achieveLines = [];
    let currentSection = 'desc';

    for (const line of lines) {
      if (/^(工作成果|主要成果|工作业绩|量化成果|主要成效|成果|业绩)[：:]/i.test(line)) {
        currentSection = 'achieve';
        const c = line.replace(/^(工作成果|主要成果|工作业绩|量化成果|主要成效|成果|业绩)[：:]/i, '').trim();
        if (c) achieveLines.push(c);
      } else if (/^(工作职责|岗位职责|工作内容|负责内容|主要职责|职责)[：:]/i.test(line)) {
        currentSection = 'desc';
        const c = line.replace(/^(工作职责|岗位职责|工作内容|负责内容|主要职责|职责)[：:]/i, '').trim();
        if (c) descLines.push(c);
      } else if (/[0-9]+%|降低[0-9]+|提升[0-9]+|节省|产出|上线|获奖/i.test(line) && currentSection === 'achieve') {
        achieveLines.push(line);
      } else {
        if (currentSection === 'achieve') achieveLines.push(line);
        else descLines.push(line);
      }
    }

    return {
      description: descLines.filter(Boolean).join('\n').trim() || rawDesc,
      achievements: rawAchieve || achieveLines.filter(Boolean).join('\n').trim()
    };
  }

  // 从日期字符串中提取年和月 (支持 2025-09, 2025.09, 2025/09, 2025年9月)
  function parseYearMonth(dateStr) {
    if (!dateStr) return { year: '', month: '', padMonth: '', full: '' };
    const clean = String(dateStr).trim();
    const m = clean.match(/(\d{4})[-/.\s年]?(\d{1,2})?/);
    if (m) {
      const year = m[1];
      const month = m[2] ? String(parseInt(m[2], 10)) : '';
      const padMonth = m[2] ? m[2].padStart(2, '0') : '';
      return {
        year,
        month,
        padMonth,
        full: /^\d{4}-\d{2}-\d{2}$/.test(clean) ? clean : (month ? `${year}-${padMonth}` : year)
      };
    }
    return { year: '', month: '', padMonth: '', full: clean };
  }

  function hintKey(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/[*＊]/g, '')
      .replace(/必填项未填写|必填|选填/g, '')
      .replace(/[\s:：\-_/|（）()【】\[\]·]+/g, '')
      .trim();
  }

  const FIELD_ALIASES = [
    ['fullName', ['真实姓名', '中文姓名', '姓名', 'fullname', 'yourname']],
    ['phone', ['手机号码', '联系电话', '手机号', '电话号码', '移动电话', '手机', '电话', 'mobilephone', 'phonenumber', 'mobile', 'phone', 'tel']],
    ['email', ['电子邮箱', '邮箱地址', '邮件', '邮箱', 'email', 'e-mail', 'mail']],
    ['gender', ['性别', 'gender', 'sex']],
    ['birthDate', ['出生日期', '出生年月', '出生时间', '生日', 'birthday', 'birthdate', 'dateofbirth']],
    ['idCard', ['身份证号', '身份证', '证件号码', '证件号', 'idcard']],
    ['politicalStatus', ['政治面貌', '党派', '政治']],
    ['ethnicity', ['民族']],
    ['hometown', ['籍贯']],
    ['sourcePlace', ['生源地']],
    ['registeredAddress', ['户口所在地', '户籍所在地', '户籍地', '户籍']],
    ['graduationDate', ['预计毕业时间', '毕业时间', '毕业年月', '毕业年份']],
    ['maritalStatus', ['婚姻状况', '婚姻情况', '婚否', 'maritalstatus']],
    ['currentCity', ['现居住城市', '现居住地', '目前所在地', '现所在地', '现居地']],
    ['emergencyContact', ['紧急联系人姓名', '紧急联络人', '紧急联系人']],
    ['emergencyRelation', ['与本人关系', '紧急联系人关系', '联系人关系']],
    ['emergencyPhone', ['紧急联系人电话', '紧急联系人手机', '紧急联系电话']],
    ['expectedCity', ['期望工作地点', '意向工作地点', '期望城市', '意向城市', '期望工作地']],
    ['expectedPosition', ['期望岗位', '意向岗位', '求职岗位', '目标职位', '应聘职位', '求职意向']],
    ['expectedSalary', ['期望薪资', '期望月薪', '薪资要求', '期望年薪']],
    ['availableDate', ['最快到岗', '到岗时间', '可入职时间']],
    ['referralCode', ['内推码', '推荐码', '推荐人', '伯乐码', '内推人']],
    ['recruitSource', ['招聘渠道', '信息来源', '获知渠道', '渠道来源']],
    ['willingToTravel', ['是否愿意出差', '是否接受出差', '出差意愿', '驻外意愿']],
    ['cet4', ['英语四级', '四级成绩', '四级', 'cet4']],
    ['cet6', ['英语六级', '六级成绩', '六级', 'cet6']],
    ['ielts', ['雅思成绩', '雅思', 'ielts']],
    ['toefl', ['托福成绩', '托福', 'toefl']],
    ['otherLanguages', ['其他外语', '第二外语', '小语种', '外语能力']],
    ['awards', ['获奖经历', '竞赛获奖', '荣誉奖项', '奖项', '荣誉']],
    ['certificates', ['资格证书', '职业证书', '证书名称', '所获证书']],
    ['certificateCode', ['证书编号', '资格证编号']],
    ['certificateIssuer', ['颁发机构', '发证机构']],
    ['certificateDate', ['取得日期', '获证日期', '发证日期']],
    ['certificateExpiryDate', ['有效期至', '证书有效期']],
    ['familyName', ['家庭成员姓名', '家属姓名', '亲属姓名', '成员姓名', '父亲姓名', '母亲姓名', '配偶姓名']],
    ['familyRelation', ['亲属关系', '家庭成员关系', '与家庭成员关系']],
    ['familyEmployer', ['家庭成员工作单位', '亲属工作单位', '家属工作单位']],
    ['familyPosition', ['家庭成员职务', '亲属职务', '家属职务']],
    ['familyPhone', ['家庭成员电话', '亲属联系电话', '家属电话', '亲属电话', '成员电话']],
    ['school', ['最高学历院校', '毕业学校', '毕业院校', '就读院校', '学校名称', '院校名称', 'school', 'university']],
    ['college', ['所属学院', '院系名称', '学院', '院系']],
    ['major', ['所学专业', '专业名称', '专业', 'major']],
    ['degree', ['最高学历', '学历层次', '学历']],
    ['academicDegree', ['学位', 'academicdegree']],
    ['secondMajor', ['第二专业', '辅修专业']],
    ['degreeType', ['培养方式', '学习形式', '学历类型']],
    ['schoolType', ['院校层次', '学校层次', '院校类别', '学校类型']],
    ['gpa', ['平均绩点', 'gpa', '绩点', '平均分']],
    ['rank', ['专业排名', '成绩排名', '班级排名', '排名']],
    ['courses', ['主修课程', '核心课程', '专业课程']],
    ['eduStartDate', ['入学时间', '入学年份', '入学年月', '就读开始']],
    ['eduEndDate', ['毕业时间', '预计毕业', '就读结束']],
    ['company', ['实习单位', '工作单位', '公司名称', '单位名称', '公司', '单位']],
    ['department', ['所属部门', '实习部门', '部门', '业务线']],
    ['position', ['担任职位', '实习岗位', '职位名称', '职务']],
    ['workCity', ['实习地点', '工作地点', '工作城市']],
    ['workStartDate', ['入职时间', '入职年月', '实习开始', '工作开始']],
    ['workEndDate', ['离职时间', '离职年月', '实习结束', '工作结束']],
    ['workDescription', ['实习职责', '工作职责', '工作内容', '工作描述', '主要工作', '岗位职责']],
    ['workAchievements', ['工作成果', '量化成果', '实习产出', '主要业绩', '核心贡献']],
    ['workType', ['工作性质', '实习类型', '雇佣类型']],
    ['projectName', ['项目名称', '项目名']],
    ['projectRole', ['项目中角色', '担任角色', '项目角色']],
    ['projectStartDate', ['项目开始', '项目起始']],
    ['projectEndDate', ['项目结束', '项目截止']],
    ['techStack', ['技术栈', '关键技术', '使用技术', '开发技术', '核心技术', '所用技术']],
    ['projectUrl', ['项目链接', '作品链接', '作品集链接', '在线地址', '演示地址']],
    ['projectResponsibilities', ['项目中职责', '项目职责', '个人职责', '主要职责', '负责内容', '个人分工']],
    ['projectAchievements', ['项目成果', '项目业绩', '主要成果', '项目产出']],
    ['projectDescription', ['项目描述', '项目背景', '项目简介', '项目介绍', '项目内容', '项目概述']],
    ['skills', ['专业技能', '技能特长', '个人技能', '技能']],
    ['introduction', ['自我介绍', '个人简介', '自我评价', '个人评价', '开放问答题', '开放题']],
    ['location', ['居住地址', '通信地址', '联系地址', '所在地', '地址']],
    ['city', ['城市']],
    ['github', ['github']],
    ['linkedin', ['linkedin', '领英']],
    ['resume', ['简历附件', '附件简历', 'resume', '简历']]
  ];

  const SECTION_SHORT_ALIASES = {
    edu: [
      ['school', ['学校', '院校', '高校', '名称']],
      ['major', ['专业']],
      ['degree', ['学历', '层次']],
      ['academicDegree', ['学位']],
      ['secondMajor', ['第二专业', '辅修专业']],
      ['college', ['学院', '院系']],
      ['eduStartDate', ['开始时间', '开始日期', '起始时间', '入学']],
      ['eduEndDate', ['结束时间', '结束日期', '截止时间', '毕业']]
    ],
    work: [
      ['company', ['公司', '单位', '企业', '名称']],
      ['position', ['职位', '岗位', '职务']],
      ['workDescription', ['内容', '描述', '职责', '介绍']],
      ['workStartDate', ['开始时间', '开始日期', '起始时间']],
      ['workEndDate', ['结束时间', '结束日期', '截止时间']]
    ],
    project: [
      ['projectName', ['名称', '项目']],
      ['projectDescription', ['内容', '描述', '介绍', '简介', '概述']],
      ['projectResponsibilities', ['职责', '负责']],
      ['projectRole', ['角色', '担任']],
      ['projectStartDate', ['开始时间', '开始日期', '起始时间']],
      ['projectEndDate', ['结束时间', '结束日期', '截止时间']]
    ],
    family: [
      ['familyName', ['姓名', '名称']],
      ['familyRelation', ['关系', '与本人关系']],
      ['familyEmployer', ['工作单位', '单位']],
      ['familyPosition', ['职务', '职位']],
      ['familyPhone', ['联系电话', '电话', '手机']]
    ],
    certificate: [
      ['certificates', ['证书名称', '名称']],
      ['certificateCode', ['证书编号', '编号']],
      ['certificateIssuer', ['颁发机构', '发证机构', '机构']],
      ['certificateDate', ['取得日期', '发证日期', '日期']],
      ['certificateExpiryDate', ['有效期至', '有效期']]
    ]
  };

  function scoreAliasHit(hint, key) {
    if (!hint || !key) return 0;
    if (hint === key) return 1000 + key.length;
    if (key.length <= 2) return 0;
    if (hint.startsWith(key) || hint.endsWith(key)) return 600 + key.length * 12;
    if (hint.includes(key)) return 300 + key.length * 12;
    return 0;
  }

  function matchAliasTable(hint, table, bonus) {
    let best = null;
    let bestScore = 0;
    for (const [type, keys] of table) {
      for (const key of keys) {
        const score = scoreAliasHit(hint, hintKey(key)) + (bonus || 0);
        if (score > bestScore) {
          bestScore = score;
          best = type;
        }
      }
    }
    return bestScore >= 300 ? best : null;
  }

  function matchFieldType(element) {
    if (isIgnoredInput(element) || isProtectedQuestion(getClosestLabelText(element))) return null;
    if (/^(自我评价|求职目标|游戏经历|编程语言|ai工具使用经历|爱好特长|优势不足)$/.test(getClosestLabelText(element))) return null;
    if (isMokaForm() && element.closest('[class*="apply-field-"]')) {
      if (/^(年|月)$/.test(element.placeholder || '')) return null;
      const label = getClosestLabelText(element);
      const block = element.closest('[data-nav-id]')?.getAttribute('data-nav-id');
      if (block === 'block-practiceInfo' && label === '工作职责') return 'workDescription';
      return ({
        姓名: 'fullName', 手机号码: element.placeholder === '请输入手机号' ? 'phone' : null,
        邮箱: 'email', 性别: 'gender', '出生日期 (年龄)': 'birthDate',
        最高学历: 'degree', 籍贯: 'hometown', '当前所在城市（市）': 'currentCity',
        推荐码: 'referralCode', 学校名称: 'school', 专业名称: 'major', 学历: 'degree',
        公司名称: 'company', 职位名称: 'position', 项目名称: 'projectName',
        项目描述: 'projectDescription', 项目中职责: 'projectResponsibilities', 作品集链接: 'portfolioLinks'
      })[label] || null;
    }

    const features = getElementFeatures(element);
    const hint = hintKey(features.label || features.placeholder);
    const section = nearestSectionKind(element);

    if (hint && /起止时间|起止日期|开始结束/.test(hint)) {
      if (section === 'work') return 'workStartDate';
      if (section === 'project') return 'projectStartDate';
      if (section === 'birth') return 'birthDate';
      if (section === 'certificate') return 'certificateDate';
      if (section !== 'family') return 'eduStartDate';
    }
    if (hint && /开始时间|开始日期|起始时间|起始日期/.test(hint)) {
      if (section === 'work') return 'workStartDate';
      if (section === 'project') return 'projectStartDate';
      if (section === 'edu') return 'eduStartDate';
      if (section === 'certificate') return 'certificateDate';
    }
    if (hint && /结束时间|结束日期|截止时间|截止日期/.test(hint)) {
      if (section === 'work') return 'workEndDate';
      if (section === 'project') return 'projectEndDate';
      if (section === 'edu') return 'eduEndDate';
      if (section === 'certificate') return 'certificateExpiryDate';
    }

    const familyHint = hint && /家庭成员|家属|亲属|直系|父亲姓名|母亲姓名|配偶姓名|家人姓名|familymember|relativename/.test(hint);
    if (hint && (section === 'family' || familyHint) && SECTION_SHORT_ALIASES.family) {
      const familyHit = matchAliasTable(hint, SECTION_SHORT_ALIASES.family, 80);
      if (familyHit) return familyHit;
    }

    if (hint && section && SECTION_SHORT_ALIASES[section]) {
      const sectional = matchAliasTable(hint, SECTION_SHORT_ALIASES[section], 80);
      if (sectional) return sectional;
    }

    if (hint) {
      const aliased = matchAliasTable(hint, FIELD_ALIASES, 0);
      if (aliased) return aliased;
    }

    const texts = [features.label, features.placeholder, features.name, features.id].filter(Boolean);
    for (const [fieldType, patterns] of Object.entries(FIELD_PATTERNS)) {
      const exact = patterns[0];
      for (const text of texts) {
        if (exact && exact.test(text)) return fieldType;
      }
    }
    for (const [fieldType, patterns] of Object.entries(FIELD_PATTERNS)) {
      const fuzzy = patterns[1];
      if (fuzzy && features.label && fuzzy.test(features.label)) return fieldType;
    }
    return null;
  }

  // ========================================================================
  // 表单扫描与填充 (智能多段经历映射 · 智能字段解耦)
  // ========================================================================

  function isXhsForm() {
    return location.hostname === 'job.xiaohongshu.com' && !!document.querySelector('#form_item_name');
  }

  async function fillXhsControl(input, value) {
    const picker = input.closest('.ant-picker');
    if (picker) {
      if (!/^\d{4}-\d{2}(?:-\d{2})?$/.test(String(value))) return false;
      document.activeElement?.blur();
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      document.body.click();
      await sleep(150);
      input.focus();
      input.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
      input.click();
      await sleep(150);
      const popup = () => [...document.querySelectorAll('.ant-picker-dropdown')].find(el => isElementTrulyVisible(el) && !/hidden|leave/.test(el.className));
      for (let attempt = 0; attempt < 10 && !popup(); attempt++) await sleep(50);
      const monthPanel = !!popup()?.querySelector('.ant-picker-month-panel');
      const target = monthPanel ? String(value).slice(0, 7) : String(value);
      let picked = false;
      if (monthPanel || /^\d{4}-\d{2}-\d{2}$/.test(target)) {
        for (let step = 0; step < 120; step++) {
          const panel = popup();
          if (!panel) break;
          const cell = [...panel.querySelectorAll('td[title]:not(.ant-picker-cell-disabled)')].find(el => el.title === target);
          if (cell) { cell.querySelector('.ant-picker-cell-inner')?.click(); picked = true; break; }
          const year = parseInt(panel.querySelector('.ant-picker-year-btn')?.textContent, 10);
          const month = parseInt(panel.querySelector('.ant-picker-month-btn')?.textContent, 10);
          if (!year) break;
          const targetYear = Number(target.slice(0, 4)), targetMonth = Number(target.slice(5, 7));
          const direction = year !== targetYear ? (targetYear < year ? 'super-prev' : 'super-next')
            : (!monthPanel && month ? (targetMonth < month ? 'prev' : 'next') : '');
          if (!direction) break;
          panel.querySelector(`.ant-picker-header-${direction}-btn`)?.click();
          await sleep(45);
        }
      }
      input.blur();
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      document.body.click();
      await sleep(150);
      return picked && input.value === target;
    }
    const select = input.closest('.ant-select');
    if (!select || select.classList.contains('ant-select-auto-complete')) {
      const ok = setValue(input, value);
      input.blur();
      await sleep(80);
      return ok && input.value === String(value);
    }
    document.activeElement?.blur();
    document.body.dispatchEvent(new MouseEvent('mousedown', {bubbles: true}));
    document.body.click();
    await sleep(150);
    select.querySelector('.ant-select-selector').dispatchEvent(new MouseEvent('mousedown', {bubbles: true, button: 0}));
    let hit;
    for (let step = 0; step < 10 && !hit; step++) {
      await sleep(100);
      hit = [...document.querySelectorAll('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option')]
        .find(el => isElementTrulyVisible(el) && !/leave|hidden/.test(el.closest('.ant-select-dropdown')?.className || '') && !el.classList.contains('ant-select-item-option-disabled') && optionTextEquals(el.textContent, value));
    }
    if (hit) hit.click();
    document.body.dispatchEvent(new MouseEvent('mousedown', {bubbles: true}));
    input.blur();
    await sleep(100);
    return !!hit && optionTextEquals(select.querySelector('.ant-select-selection-item')?.textContent, value);
  }

  async function fillXhsForm(profile) {
    const items = () => [...document.querySelectorAll('.ant-form-item')];
    const label = item => item.querySelector('.ant-form-item-label')?.textContent.trim();
    const byLabel = name => items().filter(item => label(item) === name);
    for (const [field, buttonText, entries] of [
      ['学校', '添加教育经历', profile.education || []],
      ['公司', '添加实习经历', profile.workExperience || []],
      ['竞赛/奖项名称', '添加竞赛/奖项', profile.awards || []],
      ['论文名称', '添加论文', profile.papers || []],
      ['专利名称', '添加专利', profile.patents || []],
      ['证书名称', '添加证书', (profile.certificates || []).filter(p => p.name)]
    ]) {
      while (byLabel(field).length < entries.length) {
        const button = [...document.querySelectorAll('button,span')].find(el => el.textContent.trim() === buttonText && isElementTrulyVisible(el));
        if (!button) break;
        const count = byLabel(field).length;
        button.click();
        for (let step = 0; step < 10 && byLabel(field).length === count; step++) await sleep(100);
        if (byLabel(field).length === count) break;
      }
    }
    let filledCount = 0;
    const manualFields = [];
    const occurrences = {};
    const intro = profile.introTemplates?.default || '';
    const githubStars = [...intro.matchAll(/(\d+)\s*Stars\b/gi)].map(m => Number(m[1]));
    const githubLinks = [...new Set([profile.basicInfo?.github, ...(profile.projects || []).map(p => p.projectUrl),
      ...(intro.match(/https:\/\/github\.com\/[A-Za-z0-9_.\/-]+/g) || [])].filter(Boolean))];
    for (const item of items()) {
      const name = label(item);
      const index = occurrences[name] || 0;
      occurrences[name] = index + 1;
      const inputs = [...item.querySelectorAll('input:not([type="file"]):not([type="checkbox"]):not([type="radio"]),textarea')];
      const input = inputs[0];
      if (!input) continue;
      const eduIndex = input.id.match(/resumeEducationInfo_(\d+)_/)?.[1];
      const workIndex = input.id.match(/resumeEmploymentInfo_(\d+)_/)?.[1];
      const edu = profile.education?.[eduIndex] || {};
      const work = profile.workExperience?.[workIndex] || {};
      const rankPercent = Number((edu.rank || '').match(/前\s*(\d+(?:\.\d+)?)\s*%/)?.[1]);
      const rankBucket = rankPercent > 0 && [5, 10, 20, 25, 50].find(n => rankPercent <= n);
      let values;
      if (eduIndex !== undefined) values = ({
        '起止时间': [edu.startDate, edu.endDate], '学校': [edu.school], '专业': [edu.major], '院系': [edu.college],
        '学历': [({硕士:'硕士研究生',博士:'博士研究生'})[edu.degree] || edu.degree], '成绩排名': [rankBucket ? `TOP${rankBucket}%` : edu.rank]
      })[name];
      else if (workIndex !== undefined) values = ({
        '起止时间': [work.startDate, work.endDate], '公司': [work.company], '部门': [work.department],
        '职位': [work.position], '工作性质': [work.workType], '工作描述': [[work.description, work.achievements].filter(Boolean).join('\n')]
      })[name];
      else values = ({
        '姓名': [profile.basicInfo?.fullName], '邮箱': [profile.basicInfo?.email],
        'Github 链接': [(profile.openSource?.map(p => p.url).filter(Boolean).join('\n')) || githubLinks.join('\n')],
        'Github 星级': [profile.openSource?.[0]?.stars || (githubStars.length ? String(Math.max(...githubStars)) : '')],
        '竞赛/奖项名称': [profile.awards?.[index]?.name]
      })[name];
      if (!values) continue;
      for (let i = 0; i < values.length; i++) {
        const value = values[i], el = inputs[i];
        if (!el || !value || fieldHasValue(el)) continue;
        if (await fillXhsControl(el, value)) {
          filledCount++;
          el.style.backgroundColor = '#e8f5e9';
          el.removeAttribute('data-job-autofill-manual');
        } else {
          const note = `${name}：${value}`;
          el.setAttribute('data-job-autofill-manual', note);
          el.title = `请手动选择 ${note}`;
          manualFields.push(note);
        }
      }
    }
    filledCount += await fillExtendedFields(profile);
    await handleResumeUpload(profile);
    showNotification(`已填充 ${filledCount} 个字段` + (manualFields.length ? `；请手动选择：${manualFields.join('、')}` : '；未知资料请自行补充'), 'warning');
    return {filledCount, manualFields, results: [], isForm: true};
  }

  function isBeisenForm() {
    return location.hostname === 'chinalife.zhiye.com' && !!document.querySelector('.ux-standard-form');
  }

  // 每个 ux-standard-form 是一段独立经历，不能用页面上同名字段的顺序推断归属。
  function beisenKind(form) {
    const labels = [...form.querySelectorAll('.form-item__title')].map(el => el.textContent.trim());
    if (labels.includes('文章名、书名')) return 'paper';
    if (labels.includes('论文名称')) return 'paper';
    if (labels.includes('专利名称')) return 'patent';
    if (labels.includes('证书名称')) return 'certificate';
    if (labels.includes('称谓')) return 'family';
    if (labels.includes('学校')) return 'education';
    if (labels.includes('单位名称')) return 'work';
    if (labels.includes('项目名称')) return 'project';
    if (labels.includes('奖项名称')) return 'award';
    if (labels.includes('电子邮箱')) return 'basic';
    if (labels.includes('技能类别')) return 'skills';
    if (labels.includes('自我评价及求职目标')) return 'intro';
    return '';
  }

  async function fillBeisenSelect(input, value) {
    const wrap = input.closest('.phoenix-select');
    document.body.dispatchEvent(new MouseEvent('mousedown', {bubbles: true}));
    document.body.click();
    await sleep(100);
    input.focus();
    wrap.click();
    let hit;
    for (let attempt = 0; attempt < 10 && !hit; attempt++) {
      await sleep(100);
      hit = [...document.querySelectorAll('.phoenix-selectList__listItem')].find(el =>
        isElementTrulyVisible(el) && optionTextEquals(el.textContent, value) &&
        !/disabled/i.test(el.className));
    }
    if (hit) hit.click();
    document.body.dispatchEvent(new MouseEvent('mousedown', {bubbles: true}));
    document.body.click();
    input.blur();
    await sleep(100);
    return !!hit && optionTextEquals(wrap.querySelector('.phoenix-select__tipEle')?.textContent, value);
  }

  async function fillBeisenForm(profile) {
    const lists = {
      education: profile.education || [], work: profile.workExperience || [],
      project: profile.projects || [], award: profile.awards || [], family: profile.familyMembers || [],
      paper: profile.papers || [], patent: profile.patents || [], certificate: profile.certificates || []
    };
    const addLabels = {education: '添加教育经历', work: '添加工作/实习经历',
      project: '添加参与科研项目', award: '添加学习/工作获奖情况', family: '添加家庭成员及重要社会关系', paper: '添加发表文章、著作情况', patent: '添加专利', certificate: '添加证书'};
    const forms = kind => [...document.querySelectorAll('.ux-standard-form')].filter(f => beisenKind(f) === kind);
    for (const [kind, entries] of Object.entries(lists)) {
      while (forms(kind).length && forms(kind).length < entries.length) {
        const button = [...document.querySelectorAll('span,button')].find(el =>
          el.textContent.trim().replace(/\*$/, '') === addLabels[kind] && isElementTrulyVisible(el));
        if (!button) break;
        const count = forms(kind).length;
        button.click();
        for (let attempt = 0; attempt < 10 && forms(kind).length === count; attempt++) await sleep(100);
        if (forms(kind).length === count) break;
      }
    }
    let filledCount = 0;
    const manualFields = [];
    const indices = {};
    const join = (...values) => values.filter(Boolean).join('\n');
    for (const form of document.querySelectorAll('.ux-standard-form')) {
      const kind = beisenKind(form);
      const index = indices[kind] || 0;
      indices[kind] = index + 1;
      const entry = lists[kind]?.[index] || {};
      const basic = profile.basicInfo || {};
      const maps = {
        basic: {'姓名': basic.fullName, '电子邮箱': basic.email, '移动电话': basic.phone,
          '民族': basic.ethnicity, '国籍': basic.nationality, '通信地址': basic.address,
          '是否获得过奖学金': (profile.awards || []).some(a => /奖学金/.test(a.name)) ? '是' : '',
          '是否为学生干部': (profile.education || []).some(e => /班长|学习委员|学生干部/.test(e.description || '')) ? '是' : ''},
        education: {'学校': entry.school, '专业名称': entry.major,
          '学历': ({硕士:'硕士研究生',博士:'博士研究生'})[entry.degree] || entry.degree,
          '开始时间': entry.startDate, '结束时间': entry.endDate},
        work: {'单位名称': entry.company, '所在部门': entry.department, '职位名称': entry.position,
          '用工形式': entry.workType, '工作描述': join(entry.description, entry.achievements),
          '开始时间': entry.startDate, '结束时间': entry.endDate},
        project: {'项目名称': entry.name, '担当角色': entry.role,
          '主要工作内容': join(entry.description, entry.techStack, entry.responsibilities, entry.achievements),
          '开始时间': entry.startDate, '结束时间': entry.endDate},
        award: {'奖项名称': entry.name, '获奖级别': entry.level === '校级' ? '院校级' : entry.level, '获奖时间': entry.date, '颁奖单位': entry.issuer},
        family: {'称谓': entry.relation, '姓名': entry.name, '工作单位': entry.employer, '所属职务': entry.position},
        skills: {'技能类别': Array.isArray(profile.skills) ? profile.skills.join(', ') : profile.skills?.skills},
        intro: {'自我评价及求职目标': [profile.commonAnswers?.selfEvaluation, profile.commonAnswers?.careerGoal].filter(Boolean).join('\n') || profile.introTemplates?.default}
      };
      for (const item of form.querySelectorAll('.form-item--phoenix')) {
        const label = item.querySelector('.form-item__title')?.textContent.trim();
        const value = maps[kind]?.[label];
        const input = item.querySelector('input:not([type="file"]), textarea, select');
        if (!value) continue;
        const radios = [...item.querySelectorAll('.phoenix-radio')];
        if (radios.length) {
          if (radios.some(el => el.classList.contains('phoenix-radio--checked'))) continue;
          const choice = radios.find(el => el.textContent.trim() === value);
          if (choice) {
            choice.click();
            await sleep(100);
            if (choice.classList.contains('phoenix-radio--checked')) filledCount++;
          }
          continue;
        }
        if (!input || fieldHasValue(input)) continue;
        // 本站日期精确到日，只有年月的简历不能擅自补成 1 日。
        const isDate = /时间|日期|年月/.test(label);
        const success = isDate ? await fillBeisenDate(input, value) : (input.closest('.phoenix-select')
          ? await fillBeisenSelect(input, value) : await fillField(input, value));
        if (success) {
          filledCount++;
          input.style.backgroundColor = '#e8f5e9';
          item.removeAttribute('data-job-autofill-manual');
        } else {
          const note = `${label}：${value}（请手动${isDate ? '确认具体日期' : '选择'}）`;
          item.setAttribute('data-job-autofill-manual', note);
          let hint = item.querySelector('.job-autofill-manual-hint');
          if (!hint) {
            hint = document.createElement('small');
            hint.className = 'job-autofill-manual-hint';
            item.appendChild(hint);
          }
          hint.textContent = note;
          hint.style.color = '#a65b00';
          manualFields.push(note);
        }
      }
    }
    filledCount += await fillExtendedFields(profile);
    await handleResumeUpload(profile);
    showNotification(`已填充 ${filledCount} 个字段；${manualFields.length} 项需手动确认，未知资料请自行补充`, 'warning');
    return {filledCount, manualFields, results: [], isForm: true};
  }

  async function fillForm(profile) {
    activeDeclarationQuestions = new Set((profile?.declarations || []).map(item => exactQuestion(item.question)).filter(Boolean));
    if (profile) await fillConfirmedDeclarations(profile);
    if (profile && isBeisenForm()) return fillBeisenForm(profile);
    if (profile && isXhsForm()) return fillXhsForm(profile);
    if (!profile) {
      console.log('[Capybara助手] 未找到激活的资料');
      return { filledCount: 0, isChat: false };
    }

    // 1. 优先检查当前是否处于 HR 聊天/沟通框界面
    const chatInput = findChatInputElement();
    if (chatInput) {
      const posName = detectPositionName(profile) || profile?.jobIntention?.expectedPosition || '应聘岗位';
      const compName = detectCompanyName() || '';
      const greeting = profile.skills?.intro || generateDefaultGreeting(profile, posName, compName);

      const ok = setChatInputValue(chatInput, greeting);
      if (ok) {
        if (typeof appLog !== 'undefined') {
          appLog.success('content', 'fill.chat', `已自动填充 HR 打招呼语`, { position: posName, greeting });
        }
        return { filledCount: 1, isChat: true, greeting };
      }
    }

    let filledCount = 0;
    const results = [];

    // 必须在写入“工作经历/担任职位”等输入框之前保存目标岗位，
    // 否则填充完成后的页面值可能被误识别为本次投递岗位。
    cacheJobMetaFromPage();
    await ensureMokaEntries(profile);

    // 2. 扫描所有可填充的网申输入框
    const inputs = document.querySelectorAll(
      'input[type="text"], input[type="email"], input[type="tel"], ' +
      'input[type="number"], input[type="date"], input[type="month"], input[type="url"], input[type="search"], input[type="radio"], input:not([type]), ' +
      'textarea, select, [role="combobox"], [contenteditable="true"]'
    );
    // 组件外壳和内部输入框只扫描一次，避免经历计数错位。
    const fields = [...new Set([...inputs].map((el) => writableBox(el)))].filter((el) =>
      !isIgnoredInput(el) && (isElementTrulyVisible(el) ||
        (isSelectWidget(el) && isElementTrulyVisible(el.closest('.ant-select, .el-select, .rc-select, .semi-select, .arco-select')))));

    console.log(`[Capybara助手] 扫描到 ${inputs.length} 个输入框`);
    if (typeof appLog !== 'undefined') {
      appLog.info('content', 'fill.scan', `扫描到 ${inputs.length} 个输入框`, {
        url: location.href,
        profile: profile && profile.name
      });
    }

    // 预探测：页面上是否同时存在独立的项目职责/工作成果框
    const matchedTypes = fields.map(el => matchFieldType(el)).filter(Boolean);
    const hasSeparateProjResp = matchedTypes.includes('projectResponsibilities');
    const hasSeparateProjAchieve = matchedTypes.includes('projectAchievements');
    const hasSeparateTechStack = matchedTypes.includes('techStack');
    const hasSeparateWorkAchieve = matchedTypes.includes('workAchievements');

    // 多段经历智能计数追踪
    let currentProjIdx = 0;
    let currentWorkIdx = 0;
    let currentEduIdx = 0;
    let currentFamilyIdx = 0;
    let currentCertificateIdx = 0;
    let seenProjNames = 0;
    let seenCompanies = 0;
    let seenSchools = 0;
    let seenFamilyNames = 0;
    let seenCertificates = 0;

    const projList = (profile.projects || []).filter((item) =>
      item && [item.name, item.description, item.responsibilities, item.achievements].some((value) => String(value || '').trim())
    );
    const workList = (profile.workExperience || []).filter((item) =>
      item && [item.company, item.position, item.description, item.achievements].some((value) => String(value || '').trim())
    );
    const eduList = (profile.education || []).filter((item) =>
      item && [item.school, item.major, item.degree].some((value) => String(value || '').trim())
    );
    const familyList = (profile.familyMembers || []).filter((item) =>
      item && [item.name, item.relation, item.employer, item.position, item.phone].some((value) => String(value || '').trim())
    );
    const certificateList = (profile.certificates || []).map((item) =>
      typeof item === 'string' ? { name: item } : item
    ).filter((item) => item && [item.name, item.code, item.issuer].some((value) => String(value || '').trim()));

    for (const input of fields) {
      if (isIgnoredInput(input)) continue;

      const fieldType = matchFieldType(input);
      if (!fieldType) continue;

      // 多段经历换项检测
      if (fieldType === 'projectName') {
        if (seenProjNames > 0) currentProjIdx++;
        seenProjNames++;
      } else if (fieldType === 'company') {
        if (seenCompanies > 0) currentWorkIdx++;
        seenCompanies++;
      } else if (fieldType === 'school') {
        if (seenSchools > 0) currentEduIdx++;
        seenSchools++;
      } else if (fieldType === 'familyName') {
        if (seenFamilyNames > 0) currentFamilyIdx++;
        seenFamilyNames++;
      } else if (fieldType === 'certificates') {
        if (seenCertificates > 0) currentCertificateIdx++;
        seenCertificates++;
      }

      if (input.type !== 'radio' && input.type !== 'checkbox' && fieldHasValue(input)) continue;

      // 获取当前项目数据
      const proj = projList[currentProjIdx] || {};
      const smartProj = smartExtractProjectParts(proj);
      const projStart = parseYearMonth(proj.startDate);
      const projEnd = parseYearMonth(proj.endDate);

      // 获取当前工作数据
      const work = workList[currentWorkIdx] || {};
      const smartWork = smartExtractWorkParts(work);
      const workStart = parseYearMonth(work.startDate);
      const workEnd = parseYearMonth(work.endDate);

      // 获取当前教育数据
      const edu = eduList[currentEduIdx] || {};
      const eduStart = parseYearMonth(edu.startDate);
      const eduEnd = parseYearMonth(edu.endDate);
      const family = familyList[currentFamilyIdx] || {};
      const certificate = certificateList[currentCertificateIdx] || {};

      let valueToFill = null;
      const isSelect = input.tagName.toLowerCase() === 'select';

      // 根据字段类型填充对应的值
      switch (fieldType) {
        // 基础信息
        case 'fullName':
          valueToFill = profile.basicInfo?.fullName;
          break;
        case 'firstName':
          valueToFill = profile.basicInfo?.firstName;
          break;
        case 'lastName':
          valueToFill = profile.basicInfo?.lastName;
          break;
        case 'middleName':
          valueToFill = profile.basicInfo?.middleName;
          break;
        case 'phone':
          valueToFill = profile.basicInfo?.phone;
          break;
        case 'phoneType':
          valueToFill = profile.basicInfo?.phoneType;
          break;
        case 'email':
          valueToFill = profile.basicInfo?.email;
          break;
        case 'gender':
          valueToFill = profile.basicInfo?.gender;
          break;
        case 'birthDate':
          valueToFill = profile.basicInfo?.birthDate;
          break;
        case 'idCard':
          valueToFill = profile.basicInfo?.idCard;
          break;
        case 'politicalStatus':
          valueToFill = profile.basicInfo?.politicalStatus;
          break;
        case 'ethnicity':
          valueToFill = profile.basicInfo?.ethnicity;
          break;
        case 'hometown':
          valueToFill = profile.basicInfo?.hometown;
          break;
        case 'graduationDate':
          valueToFill = profile.basicInfo?.graduationDate;
          break;
        case 'maritalStatus':
          valueToFill = profile.basicInfo?.maritalStatus;
          break;
        case 'currentCity':
          valueToFill = profile.basicInfo?.currentCity;
          break;
        case 'emergencyContact':
          valueToFill = profile.basicInfo?.emergencyContact;
          break;
        case 'emergencyRelation':
          valueToFill = profile.basicInfo?.emergencyRelation;
          break;
        case 'emergencyPhone':
          valueToFill = profile.basicInfo?.emergencyPhone;
          break;

        // 求职意向
        case 'expectedCity':
          valueToFill = profile.jobIntention?.expectedCity;
          break;
        case 'expectedPosition':
          valueToFill = profile.jobIntention?.expectedPosition;
          break;
        case 'expectedSalary':
          if (/年薪|月薪/.test(getClosestLabelText(input)) && (!profile.jobIntention?.salaryPeriod || !getClosestLabelText(input).includes(profile.jobIntention.salaryPeriod) || !profile.jobIntention.salaryUnit)) {
            if (profile.jobIntention?.expectedSalary) markManual(input, `${profile.jobIntention.expectedSalary}（请确认薪资周期和单位）`);
            break;
          }
          valueToFill = profile.jobIntention?.expectedSalary;
          break;
        case 'availableDate':
          valueToFill = profile.jobIntention?.availableDate;
          break;
        case 'referralCode':
          valueToFill = profile.jobIntention?.referralCode;
          break;
        case 'recruitSource':
          valueToFill = profile.jobIntention?.recruitSource;
          break;
        case 'willingToTravel':
          valueToFill = profile.jobIntention?.willingToTravel;
          break;

        // 语言外语
        case 'cet4':
          valueToFill = profile.languageSkills?.cet4;
          break;
        case 'cet6':
          valueToFill = profile.languageSkills?.cet6;
          break;
        case 'ielts':
          valueToFill = profile.languageSkills?.ielts;
          break;
        case 'toefl':
          valueToFill = profile.languageSkills?.toefl;
          break;
        case 'otherLanguages':
          valueToFill = profile.languageSkills?.otherLanguages;
          break;

        // 荣誉奖项
        case 'awards':
          if (Array.isArray(profile.awards) && profile.awards.length) {
            valueToFill = profile.awards.map(a => `${a.date || ''} ${a.name} (${a.level || '校级'})`.trim()).join('；');
          }
          break;
        case 'certificates':
          valueToFill = certificate.name || certificateList.map((item) => item.name).filter(Boolean).join('；');
          break;
        case 'certificateCode':
          valueToFill = certificate.code;
          break;
        case 'certificateIssuer':
          valueToFill = certificate.issuer;
          break;
        case 'certificateDate':
          valueToFill = certificate.date;
          break;
        case 'certificateExpiryDate':
          valueToFill = certificate.expiryDate;
          break;
        case 'familyName':
          valueToFill = family.name;
          break;
        case 'familyRelation':
          valueToFill = family.relation;
          break;
        case 'familyEmployer':
          valueToFill = family.employer;
          break;
        case 'familyPosition':
          valueToFill = family.position;
          break;
        case 'familyPhone':
          valueToFill = family.phone;
          break;

        // 地址信息
        case 'street':
          valueToFill = profile.basicInfo?.street;
          break;
        case 'city':
          valueToFill = profile.basicInfo?.city;
          break;
        case 'state':
          valueToFill = profile.basicInfo?.state;
          break;
        case 'country':
          valueToFill = profile.basicInfo?.country;
          break;
        case 'zipCode':
          valueToFill = profile.basicInfo?.zipCode;
          break;
        case 'location':
          valueToFill = profile.basicInfo?.location || profile.basicInfo?.address ||
                        `${profile.basicInfo?.city || ''} ${profile.basicInfo?.state || ''}`.trim();
          break;

        // 社交链接
        case 'linkedin':
          valueToFill = profile.basicInfo?.linkedin;
          break;
        case 'github':
          valueToFill = profile.basicInfo?.github;
          break;
        case 'website':
          valueToFill = profile.basicInfo?.website;
          break;
        case 'twitter':
          valueToFill = profile.basicInfo?.twitter;
          break;

        // 教育信息 (支持多段教育经历与起止年月)
        case 'school':
          valueToFill = edu.school;
          break;
        case 'college':
          valueToFill = edu.college;
          break;
        case 'major':
          valueToFill = edu.major;
          break;
        case 'academicDegree': valueToFill = edu.academicDegree; break;
        case 'secondMajor': valueToFill = edu.secondMajor; break;
        case 'sourcePlace': valueToFill = profile.basicInfo?.sourcePlace; break;
        case 'registeredAddress': valueToFill = profile.basicInfo?.registeredAddress; break;
        case 'degree':
          valueToFill = edu.degree;
          break;
        case 'degreeType':
          valueToFill = edu.degreeType;
          break;
        case 'schoolType':
          valueToFill = edu.schoolType;
          break;
        case 'gpa':
          valueToFill = edu.gpa;
          break;
        case 'rank':
          valueToFill = edu.rank;
          break;
        case 'courses':
          valueToFill = edu.courses;
          break;
        case 'educationDescription':
          valueToFill = edu.description;
          break;
        case 'eduStartDate':
          if (isSelect) {
            const hasYears = Array.from(input.options).some(o => /^\d{4}/.test(o.value || o.text));
            valueToFill = hasYears ? eduStart.year : (eduStart.month || eduStart.padMonth);
          } else {
            valueToFill = eduStart.full || edu.startDate;
          }
          break;
        case 'eduEndDate':
          if (isSelect) {
            const hasYears = Array.from(input.options).some(o => /^\d{4}/.test(o.value || o.text));
            valueToFill = hasYears ? eduEnd.year : (eduEnd.month || eduEnd.padMonth);
          } else {
            valueToFill = eduEnd.full || edu.endDate;
          }
          break;

        // 工作/实习经验 (支持多段经历与职责/产出解耦)
        case 'company':
          valueToFill = work.company;
          break;
        case 'department':
          valueToFill = work.department;
          break;
        case 'position':
          valueToFill = work.position;
          break;
        case 'workCity':
          valueToFill = work.city;
          break;
        case 'workStartDate':
          if (isSelect) {
            const hasYears = Array.from(input.options).some(o => /^\d{4}/.test(o.value || o.text));
            valueToFill = hasYears ? workStart.year : (workStart.month || workStart.padMonth);
          } else {
            valueToFill = workStart.full || work.startDate;
          }
          break;
        case 'workEndDate':
          if (isSelect) {
            const hasYears = Array.from(input.options).some(o => /^\d{4}/.test(o.value || o.text));
            valueToFill = hasYears ? workEnd.year : (workEnd.month || workEnd.padMonth);
          } else {
            valueToFill = workEnd.full || work.endDate;
          }
          break;
        case 'workType':
          valueToFill = work.workType;
          break;
        case 'workDescription':
          valueToFill = [smartWork.description, !hasSeparateWorkAchieve && smartWork.achievements].filter(Boolean).join('\n');
          break;
        case 'workAchievements':
          valueToFill = smartWork.achievements;
          break;

        // 项目经验 (支持多段项目与背景/职责/成果/技术栈智能拆分)
        case 'projectName':
          valueToFill = proj.name;
          break;
        case 'projectRole':
          valueToFill = smartProj.role || proj.role;
          break;
        case 'techStack':
          valueToFill = smartProj.techStack || proj.techStack;
          break;
        case 'projectUrl':
          valueToFill = proj.projectUrl;
          break;
        case 'portfolioLinks':
          valueToFill = [...new Set([profile.basicInfo?.github, profile.basicInfo?.website,
            ...(profile.projects || []).map(p => p.projectUrl)].filter(Boolean))].join('\n');
          break;
        case 'projectStartDate':
          if (isSelect) {
            const hasYears = Array.from(input.options).some(o => /^\d{4}/.test(o.value || o.text));
            valueToFill = hasYears ? projStart.year : (projStart.month || projStart.padMonth);
          } else {
            valueToFill = projStart.full || proj.startDate;
          }
          break;
        case 'projectEndDate':
          if (isSelect) {
            const hasYears = Array.from(input.options).some(o => /^\d{4}/.test(o.value || o.text));
            valueToFill = hasYears ? projEnd.year : (projEnd.month || projEnd.padMonth);
          } else {
            valueToFill = projEnd.full || proj.endDate;
          }
          break;
        case 'projectResponsibilities':
          // 独立「项目中职责」项，优先填入个人具体工作/职责部分
          valueToFill = smartProj.responsibilities || proj.responsibilities;
          break;
        case 'projectAchievements':
          // 独立「项目成果/业绩」项
          valueToFill = smartProj.achievements || proj.achievements;
          break;
        case 'projectDescription':
          valueToFill = [
            smartProj.description,
            !hasSeparateTechStack && smartProj.techStack && `技术栈：${smartProj.techStack}`,
            !hasSeparateProjResp && smartProj.responsibilities,
            !hasSeparateProjAchieve && smartProj.achievements && `项目成果：${smartProj.achievements}`
          ].filter(Boolean).join('\n');
          break;

        // 技能
        case 'skills':
          valueToFill = Array.isArray(profile.skills)
            ? profile.skills.join(', ')
            : (profile.skills?.skills || '');
          break;

        // 自我介绍
        case 'introduction':
          valueToFill = profile.introTemplates?.default || '';
          break;
      }

      if (valueToFill && String(valueToFill).trim() !== '') {
        const success = await fillField(input, valueToFill);
        if (success) {
          filledCount++;
          results.push({
            element: input,
            fieldType: fieldType,
            value: valueToFill
          });
          input.style.backgroundColor = '#e8f5e9';
          input.style.border = '2px solid #4caf50';
          console.log(`[Capybara助手] 填充: ${fieldType} = ${valueToFill}`);
        }
      }
    }

    filledCount += await fillYearMonthWidgets(profile);

    // 2. 处理简历文件上传
    filledCount += await fillExtendedFields(profile);
    await handleResumeUpload(profile);

    console.log(`[Capybara助手] 填充完成: ${filledCount} 个字段`);
    if (typeof appLog !== 'undefined') {
      appLog.success('content', 'fill.done', `页面填充完成，${filledCount} 个字段`, { url: location.href });
    }

    if (filledCount > 0) {
      try {
        cacheJobMetaFromPage();
        const company = detectCompanyName() || '未知企业';
        const position = detectPositionName(profile, { allowProfileFallback: false });
        chrome.runtime.sendMessage({
          action: 'recordSubmission',
          data: {
            company,
            position,
            url: window.location.href,
            date: new Date().toISOString().slice(0, 10),
            profileId: profile.id || '',
            profileName: profile.name || '默认资料',
            status: '在投'
          }
        }, (res) => {
          if (res && res.success) {
            console.log('[Capybara助手] 已自动记录投递历史:', company, position);
          }
        });
      } catch (e) {
        console.warn('[Capybara助手] 记录投递历史失败:', e);
      }
    }

    // 显示通知
    const manualFields = [...new Set([...document.querySelectorAll('[data-job-autofill-manual]')]
      .map(el => el.getAttribute('data-job-autofill-manual')))];
    showNotification(`已自动填充 ${filledCount} 个字段` +
      (manualFields.length ? ` · 请手动选择：${manualFields.join('、')}` : ' · 投递历史已记录'),
      manualFields.length ? 'warning' : 'success');

    return { filledCount, results, manualFields };
  }

  const JOB_TITLE_HINT = /工程师|开发|算法|产品|运营|设计|测试|管培|专员|经理|助理|分析师|研究员|架构师|实习|前端|后端|全栈|数据|策划|美术|原画|安全|运维|大模型|\bAI\b|游戏|客户端|服务端|量化|策略|增长|投放|审核|编辑|翻译|法务|财务|人力|HR|研发|技术|软件|硬件|嵌入式|芯片|通信|网络|自动化|机械|电气|材料|工艺|销售|商务|BD|市场|公关|客服|风控|会计|审计|采购|物流|供应链|行政|文员|顾问|教研|教师|导师|主管|总监|负责人|Leader|应届生|储备干部|管培生/;
  const JUNK_COMPANY_RE = /^(校园招聘|校招|社招|社会招聘|招聘官网|招聘|官方网站|网申系统|应届生招聘|招聘首页|登录|注册|首页|职位详情|网申|投递记录|人才招聘|mokahr|beisen|dayee|51job|zhaopin|liepin|nowcoder|boss直聘|申请职位|职位申请)$/i;
  const JUNK_POSITION_RE = /^(工作职责|岗位职责|任职要求|任职资格|岗位要求|职位描述|职位详情|投递信息|基本信息|个人信息|教育背景|工作经历|项目经历|荣誉奖励|附件简历|求职意向|账号设置|个人中心|申请表单|申请信息|填写信息|校园招聘|校招|社会招聘|登录|注册|首页|网申|校招首页|工作地点|工作城市|工作性质|工作经验|所属部门|所属业务线|职位类别|职位类型|职位方向|招聘人数|发布时间|更新时间|薪资待遇|薪酬范围|学历要求|招聘对象|投递岗位|申请职位|应聘职位|应聘岗位|目标职位|选择职位|立即申请|立即投递|投递简历|投递表单|简历预览|简历填写|查看更多|返回列表|暂无职位|暂无数据|职位列表|全部职位|搜索职位|招聘动态|招聘公告|关于我们|加入我们|人才招聘|招聘系统|海外招聘|内推专区|职位名称|岗位名称)$/i;
  const KNOWN_COMPANIES = [
    { match: /37\.com|37wan|\/37\/|37interactive|三七/i, name: '三七互娱' },
    { match: /tencent|\/tencent\//i, name: '腾讯' },
    { match: /bytedance|douyin|\/bytedance\//i, name: '字节跳动' },
    { match: /alibaba|aliyun|taobao|tmall|\/alibaba\//i, name: '阿里巴巴' },
    { match: /meituan|\/meituan\//i, name: '美团' },
    { match: /baidu|\/baidu\//i, name: '百度' },
    { match: /kuaishou|\/kuaishou\//i, name: '快手' },
    { match: /xiaohongshu|\/xiaohongshu\//i, name: '小红书' },
    { match: /pinduoduo|pdd|\/pdd\//i, name: '拼多多' },
    { match: /jd\.com|\/jd\//i, name: '京东' },
    { match: /huawei|\/huawei\//i, name: '华为' },
    { match: /xiaomi|mi\.com|\/xiaomi\//i, name: '小米' },
    { match: /bilibili|\/bilibili\//i, name: '哔哩哔哩' },
    { match: /netease|163\.com|\/netease\//i, name: '网易' },
    { match: /didi|\/didi\//i, name: '滴滴' },
    { match: /oppo|\/oppo\//i, name: 'OPPO' },
    { match: /vivo|\/vivo\//i, name: 'vivo' },
    { match: /honor|\/honor\//i, name: '荣耀' },
    { match: /nio|\/nio\//i, name: '蔚来' },
    { match: /lixiang|liuto|\/lixiang\//i, name: '理想汽车' },
    { match: /xiaopeng|xpeng|\/xiaopeng\//i, name: '小鹏汽车' },
    { match: /byd|\/byd\//i, name: '比亚迪' },
    { match: /antgroup|\/antgroup\//i, name: '蚂蚁集团' },
    { match: /shopee|\/shopee\//i, name: 'Shopee' },
    { match: /shein|\/shein\//i, name: 'SHEIN' },
    { match: /mihoyo|\/mihoyo\//i, name: '米哈游' },
    { match: /moonshot/i, name: '月之暗面' },
    { match: /cmbchina|cmb/i, name: '招商银行' },
    { match: /icbc/i, name: '工商银行' },
    { match: /ccb\.com/i, name: '建设银行' },
    { match: /boc\.cn/i, name: '中国银行' },
    { match: /abchina/i, name: '农业银行' },
    { match: /pingan/i, name: '中国平安' }
  ];

  function currentJobId() {
    const hash = location.hash || '';
    const m = hash.match(/job\/([a-z0-9-]+)/i);
    return (m && m[1]) || '';
  }

  function cleanPositionName(text) {
    if (!text) return '';
    return String(text)
      .replace(/<[^>]+>/g, '')
      .replace(/【.*?】|\[.*?\]|（.*?届.*?）|\(.*?\d{4}.*?\)/g, ' ')
      .replace(/^(?:应聘职位|申请岗位|投递职位|应聘岗位|目标职位|申请职位|职位名称|岗位名称|招聘岗位|招聘职位)[：:\s]+/g, '')
      .replace(/^[\s·\-_|:：、/]+|[\s·\-_|:：、/]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function looksLikePosition(text) {
    const t = cleanPositionName(text);
    if (t.length < 2 || t.length > 50) return false;
    if (JUNK_POSITION_RE.test(t)) return false;
    if (JUNK_COMPANY_RE.test(t)) return false;
    if (KNOWN_COMPANIES.some((c) => c.name === t)) return false;
    return true;
  }

  function readJsonLdJob() {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const s of scripts) {
      try {
        const data = JSON.parse(s.textContent || 'null');
        const items = Array.isArray(data) ? data : [data, data && data['@graph']].flat().filter(Boolean);
        for (const item of items) {
          if (item && (item['@type'] === 'JobPosting' || /JobPosting/i.test(String(item['@type'] || '')))) {
            return {
              position: String(item.title || '').trim(),
              company: String(item.hiringOrganization?.name || '').trim()
            };
          }
        }
      } catch {}
    }
    return null;
  }

  function readPositionFromMeta() {
    const selectors = [
      'meta[property="og:title"]',
      'meta[name="twitter:title"]',
      'meta[name="job-title"]',
      'meta[name="jobTitle"]',
      'meta[itemprop="title"]'
    ];
    for (const el of document.querySelectorAll(selectors.join(','))) {
      const parts = String(el.getAttribute('content') || '')
        .split(/[-_|—–\t]|\s+\/\s+/)
        .map(cleanPositionName)
        .filter(Boolean);
      for (const part of parts) {
        if (looksLikePosition(part) && JOB_TITLE_HINT.test(part)) return part;
      }
    }
    return null;
  }

  function readPositionFromUrl() {
    try {
      const search = new URLSearchParams(window.location.search);
      const hashStr = window.location.hash ? window.location.hash.split('?')[1] : '';
      const hashParams = hashStr ? new URLSearchParams(hashStr) : null;

      const keys = ['jobName', 'positionName', 'jobTitle', 'position', 'postName', 'recruitPostName', 'job_name', 'job_title', 'pos_name', 'post_name', 'title'];
      for (const k of keys) {
        let val = search.get(k) || (hashParams && hashParams.get(k));
        if (val) {
          try { val = decodeURIComponent(val); } catch {}
          val = cleanPositionName(val);
          if (looksLikePosition(val) && (JOB_TITLE_HINT.test(val) || val.length <= 24)) {
            return val;
          }
        }
      }
    } catch {}
    return null;
  }

  function readPositionFromFormInputs() {
    try {
      const inputs = document.querySelectorAll('input[name*="position" i], input[name*="job" i], input[name*="post" i], input[id*="position" i], input[id*="job" i], input[id*="post" i], [class*="apply-position"] input, [class*="applyPosition"] input');
      for (const inp of inputs) {
        if (inp.closest('#job-autofill-dock, #job-autofill-copy-panel, #job-autofill-ai-panel, #job-autofill-log-panel')) continue;
        const marker = `${inp.name || ''} ${inp.id || ''} ${inp.className || ''}`;
        if (/work|experience|intern|resume|history|经历|实习/i.test(marker)) continue;
        if (!inp.readOnly && !inp.disabled && inp.type !== 'hidden' && !/apply|target|current|recruit|应聘|申请|目标/i.test(marker)) continue;
        const val = cleanPositionName(inp.value || inp.getAttribute('value') || inp.placeholder);
        if (looksLikePosition(val) && (JOB_TITLE_HINT.test(val) || val.length <= 24)) {
          return val;
        }
      }

      const labels = document.querySelectorAll('label, .ant-form-item-label, .el-form-item__label, [class*="form-label"], [class*="item-label"]');
      for (const lbl of labels) {
        if (lbl.closest('#job-autofill-dock, #job-autofill-copy-panel, #job-autofill-ai-panel, #job-autofill-log-panel')) continue;
        const txt = lbl.textContent.trim();
        if (/应聘职位|申请岗位|投递职位|应聘岗位|目标职位|申请职位|职位名称|岗位名称/.test(txt)) {
          const item = lbl.closest('.ant-form-item, .el-form-item, .form-item, .form-group, [class*="formItem"], tr, div');
          if (item) {
            const valEl = item.querySelector('input, select, .ant-form-item-control, .el-form-item__content, [class*="value"], [class*="content"]');
            if (valEl) {
              const genericLabel = /^(?:职位名称|岗位名称)[：:]?$/.test(txt.replace(/\s+/g, ''));
              if (genericLabel && valEl.matches?.('input, select, textarea') && !valEl.readOnly && !valEl.disabled) continue;
              const val = cleanPositionName(valEl.value || valEl.textContent);
              if (looksLikePosition(val) && !/职位名称|岗位名称/.test(val)) {
                return val;
              }
            }
          }
        }
      }
    } catch {}
    return null;
  }

  function readPositionFromBreadcrumbs() {
    try {
      const crumbContainers = document.querySelectorAll('.breadcrumb, .breadcrumbs, .ant-breadcrumb, .el-breadcrumb, .arco-breadcrumb, .semi-breadcrumb, [class*="breadcrumb" i], [class*="Breadcrumb"]');
      for (const container of crumbContainers) {
        if (container.closest('#job-autofill-dock, #job-autofill-copy-panel, #job-autofill-ai-panel, #job-autofill-log-panel')) continue;
        const items = container.querySelectorAll('li, a, span, [class*="item"]');
        if (items.length > 1) {
          for (let i = items.length - 1; i >= 0; i--) {
            const text = cleanPositionName(items[i].textContent);
            if (looksLikePosition(text) && (JOB_TITLE_HINT.test(text) || text.length <= 24)) {
              return text;
            }
          }
        }
      }
    } catch {}
    return null;
  }

  function saveJobMeta(meta) {
    try {
      if (!meta) return;
      const prev = loadJobMeta() || {};
      const newPos = (meta.position && looksLikePosition(meta.position)) ? cleanPositionName(meta.position) : (prev.position || '');
      const newComp = (meta.company && meta.company !== '未知企业') ? meta.company.trim() : (prev.company || '未知企业');
      if (!newPos && (!newComp || newComp === '未知企业')) return;

      const jobId = currentJobId() || location.pathname;
      const merged = { company: newComp, position: newPos, jobId, savedAt: Date.now() };
      sessionStorage.setItem('capybaraJobMeta', JSON.stringify(merged));
    } catch {}
  }

  function loadJobMeta() {
    try {
      const raw = sessionStorage.getItem('capybaraJobMeta');
      if (!raw) return null;
      const meta = JSON.parse(raw);
      return meta && (meta.position || meta.company) ? meta : null;
    } catch {
      return null;
    }
  }

  function readPositionFromStructuredDom() {
    const selectors = [
      '.job-name', '.job-title', '.position-name', '.position-title',
      '[class*="jobName"]', '[class*="jobTitle"]', '[class*="positionTitle"]',
      '[class*="job-name"]', '[class*="job-title"]', '[class*="position-name"]', '[class*="position-title"]',
      '[class*="postName"]', '[class*="post-name"]', '[class*="postTitle"]',
      '.job-detail-header h1', '.job-banner h1', 'h1.job-title', '.job-header-title',
      '[class*="apply-job"] h1', '[class*="job-info"] h1', '[class*="job-info"] h2',
      '.pos-name', '.post-title', '#lblJobTitle', '.detail-title', '[class*="detailTitle"]',
      '[class*="JobDetail_title"]', '[class*="JobHeader"] h1', '[class*="headerTitle"]',
      '[data-automation-id="jobPostingHeader"]', '[data-automation-id*="jobTitle" i]',
      '[data-testid*="job-title" i]', '[data-testid*="position-title" i]',
      '[data-qa*="job-title" i]', '[itemprop="title"]',
      '[data-job-title]', '[data-job-name]', '[data-position-name]'
    ];
    for (const sel of selectors) {
      for (const el of document.querySelectorAll(sel)) {
        if (el.closest('#job-autofill-dock, #job-autofill-copy-panel, #job-autofill-ai-panel, #job-autofill-log-panel')) continue;
        const raw = el.getAttribute('data-job-title') || el.getAttribute('data-job-name') ||
          el.getAttribute('data-position-name') || el.getAttribute('content') || el.textContent;
        const text = cleanPositionName(raw);
        if (looksLikePosition(text) && (JOB_TITLE_HINT.test(text) || text.length <= 24)) return text;
      }
    }
    return null;
  }

  function detectCompanyName() {
    const url = window.location.href.toLowerCase();
    const host = window.location.hostname.toLowerCase();
    const cached = loadJobMeta();

    for (const item of KNOWN_COMPANIES) {
      if (item.match.test(host) || item.match.test(url) || item.match.test(document.title || '')) return item.name;
    }

    const jsonld = readJsonLdJob();
    if (jsonld && jsonld.company && !JUNK_COMPANY_RE.test(jsonld.company)) return jsonld.company;

    const og = document.querySelector('meta[property="og:site_name"], meta[property="og:title"]');
    if (og) {
      const parts = String(og.getAttribute('content') || '').split(/[-_|—–]/).map((s) => s.trim());
      const hit = parts.find((p) => p.length >= 2 && p.length <= 20 && !JUNK_COMPANY_RE.test(p) && /公司|科技|集团|证券|银行|互娱|游戏|网络|软件/.test(p));
      if (hit) return hit;
    }

    const logoImgs = document.querySelectorAll('img[alt], img[title], .org-name, .company-name, [class*="company-name"], [class*="org-name"]');
    for (const el of logoImgs) {
      const text = (el.alt || el.title || el.textContent || '').trim();
      const clean = text.replace(/校园招聘|校招|社会招聘|招聘官网|招聘|官方网站|网申系统|人才招聘/g, '').trim();
      if (clean.length >= 2 && clean.length <= 20 && !JUNK_COMPANY_RE.test(clean)) return clean;
    }

    if (cached && cached.company && !JUNK_COMPANY_RE.test(cached.company)) return cached.company;

    const parts = (document.title || '').split(/[-_|—–\/]/).map((s) => s.replace(/【.*?】|\[.*?\]/g, '').trim()).filter(Boolean);
    for (const p of parts) {
      const clean = p.replace(/校园招聘|校招|社会招聘|招聘官网|招聘|官方网站/g, '').trim();
      if (clean.length >= 2 && clean.length <= 20 && !JUNK_COMPANY_RE.test(clean) && /公司|科技|集团|证券|银行|互娱|游戏|网络|软件|制造|生物|医药/.test(clean)) {
        return clean;
      }
    }

    return '未知企业';
  }

  function detectPositionName(profile, options = {}) {
    const jsonld = readJsonLdJob();
    if (jsonld && looksLikePosition(jsonld.position)) {
      return cleanPositionName(jsonld.position);
    }

    const metaPos = readPositionFromMeta();
    if (metaPos) return metaPos;

    const urlPos = readPositionFromUrl();
    if (urlPos) return urlPos;

    const domPos = readPositionFromStructuredDom();
    if (domPos) return domPos;

    const crumbPos = readPositionFromBreadcrumbs();
    if (crumbPos) return crumbPos;

    const headings = document.querySelectorAll('h1, h2, h3');
    for (const el of headings) {
      if (el.closest('#job-autofill-dock, #job-autofill-copy-panel, #job-autofill-ai-panel, #job-autofill-log-panel')) continue;
      const text = cleanPositionName(el.textContent);
      if (looksLikePosition(text) && JOB_TITLE_HINT.test(text)) {
        return text;
      }
    }

    const labeled = (document.body.innerText || '').match(/(?:应聘职位|申请岗位|投递职位|应聘岗位|目标职位|申请职位|职位名称|岗位名称)[：:\s]+([^\n\r]{2,40})/);
    if (labeled) {
      const found = cleanPositionName(labeled[1].split(/[，,。；;（(]/)[0]);
      if (looksLikePosition(found) && !/职位名称|岗位名称/.test(found)) return found;
    }

    const titleParts = (document.title || '')
      .split(/[-_|—–\t]|\s+\/\s+/)
      .map(cleanPositionName)
      .filter(Boolean);
    for (const part of titleParts) {
      if (looksLikePosition(part) && JOB_TITLE_HINT.test(part)) return part;
    }

    // 表单输入值仅作最后的页面级兜底，避免把已填入的工作经历职位当成目标岗位。
    const formPos = readPositionFromFormInputs();
    if (formPos) return formPos;

    const cached = loadJobMeta();
    if (cached && looksLikePosition(cached.position) && !JUNK_POSITION_RE.test(cached.position)) {
      return cleanPositionName(cached.position);
    }

    const prof = profile || currentActiveProfile;
    if (options.allowProfileFallback !== false && prof?.jobIntention?.expectedPosition && looksLikePosition(prof.jobIntention.expectedPosition)) {
      return cleanPositionName(prof.jobIntention.expectedPosition);
    }

    return '网申岗位';
  }

  function cacheJobMetaFromPage() {
    const position = detectPositionName(null, { allowProfileFallback: false });
    const company = detectCompanyName();

    if (typeof appLog !== 'undefined') {
      appLog.info('content', 'job.cache', '缓存页面岗位信息', {
        company: company || '未检测到',
        position: position || '未检测到',
        url: window.location.href
      });
    }

    if ((position && position !== '未知岗位' && position !== '网申岗位') || (company && company !== '未知企业')) {
      saveJobMeta({ company, position });
    }
  }

  function classifySectionTitle(text) {
    const t = String(text || '').replace(/\s+/g, '').slice(0, 24);
    if (!t || t.length > 18) return '';
    if (/家庭成员|家庭情况|家属信息|亲属信息|直系亲属|家庭信息/.test(t)) return 'family';
    if (/资格证书|职业证书|证书信息|所获证书/.test(t)) return 'certificate';
    if (/教育经历|教育背景|教育信息|学习经历|学历信息/.test(t) || (/教育|学历|院校/.test(t) && !/最高学历/.test(t))) return 'edu';
    if (/项目经历|项目经验|项目信息/.test(t) || (/项目/.test(t) && !/项目名称|项目角色|项目描述|项目职责|项目成果/.test(t))) return 'project';
    if (/工作经历|实习经历|工作经验|任职经历|工作信息|实习信息/.test(t) || /^(实习|工作|任职)$/.test(t)) return 'work';
    if (/出生|生日/.test(t)) return 'birth';
    return '';
  }

  function nearestSectionKind(el) {
    let node = el;
    for (let i = 0; i < 8 && node; i++) {
      let prev = node.previousElementSibling;
      while (prev) {
        const kind = classifySectionTitle(prev.textContent);
        if (kind) return kind;
        prev = prev.previousElementSibling;
      }
      const selfKind = classifySectionTitle(node.getAttribute && node.getAttribute('data-title'));
      if (selfKind) return selfKind;
      node = node.parentElement;
    }

    const top = el.getBoundingClientRect().top;
    const heads = [...document.querySelectorAll('h2, h3, h4, legend, [class*="section-title"], [class*="group-title"], [class*="module-title"]')];
    let best = '';
    let bestDist = 1e9;
    for (const h of heads) {
      const t = h.getBoundingClientRect().top;
      if (t <= top + 8) {
        const d = top - t;
        if (d < bestDist) {
          bestDist = d;
          best = h.textContent.trim();
        }
      }
    }
    return classifySectionTitle(best);
  }

  function isMokaForm() {
    return location.hostname === 'app.mokahr.com' && /^\/campus-recruitment\/37\//.test(location.pathname) && !!document.querySelector('[data-nav-id="block-educationInfo"]');
  }

  async function fillMokaSelect(el, value) {
    const wrap = el.closest('[class*="sd-Dropdown-container-"]');
    if (!wrap) return false;
    el.scrollIntoView({ block: 'center' });
    el.click();
    const findOption = () => [...wrap.querySelectorAll('[class*="sd-Select-menu-"] [class*="sd-Menu-container-"]')]
      .filter(option => isElementTrulyVisible(option) && !/disabled/i.test(option.className))
      .find(option => optionTextEquals(option.querySelector('[class*="sd-Menu-content-item-"]')?.firstElementChild?.textContent || option.textContent, value));
    await sleep(120);
    let option = findOption();
    if (!option && !el.readOnly) {
      nativeSet(el, HTMLInputElement.prototype, value);
      dispatchInputEvents(el, value);
      for (let i = 0; i < 15 && !option; i++) {
        await sleep(100);
        option = findOption();
      }
    }
    if (option) (option.querySelector('[class*="sd-Menu-container-"]') || option).click();
    else document.body.click();
    el.blur();
    await sleep(100);
    const selected = wrap.querySelector('[class*="sd-Input-display-value-"]')?.textContent || '';
    const success = optionTextEquals(selected, value);
    if (success) el.removeAttribute('data-job-autofill-manual');
    else el.setAttribute('data-job-autofill-manual', getClosestLabelText(el) || el.placeholder || '下拉框');
    return success;
  }

  function mokaExperienceGroups(profile) {
    return [
      ['educationInfo', (profile.education || []).filter(e => e.school || e.major)],
      ['practiceInfo', (profile.workExperience || []).filter(e => e.company || e.position)],
      ['projectInfo', (profile.projects || []).filter(e => e.name)]
    ];
  }

  async function ensureMokaEntries(profile) {
    if (!isMokaForm()) return;
    for (const [key, items] of mokaExperienceGroups(profile)) {
      const block = document.querySelector(`[data-nav-id="block-${key}"]`);
      if (!block) continue;
      const rows = () => [...block.children].filter(e => e.matches('[class*="apply-fields-"]'));
      while (rows().length < items.length) {
        const add = [...block.querySelectorAll('button')].find(b => b.textContent.trim() === '添加');
        if (!add || add.disabled) break;
        const count = rows().length;
        add.scrollIntoView({ block: 'center' });
        add.click();
        for (let i = 0; i < 15 && rows().length === count; i++) await sleep(100);
        if (rows().length === count) break;
      }
    }
  }

  async function fillMokaDates(profile) {
    let count = 0;
    async function fillDateControls(container, dates) {
      const controls = [...container.querySelectorAll('.month-range-select input[type="text"]')];
      // Moka 选择年份时会自动补成 1 月；只保护本轮开始前已有的值。
      const hadValues = controls.map(fieldHasValue);
      const values = dates.flatMap(date => { const d = parseYearMonth(date); return [d.year, d.month]; });
      for (let i = 0; i < controls.length; i++) {
        if (values[i] && !hadValues[i] && await fillField(controls[i], values[i])) count++;
      }
    }
    for (const [key, items] of mokaExperienceGroups(profile)) {
      const rows = document.querySelectorAll(`[data-nav-id="block-${key}"] > [class*="apply-fields-"]`);
      for (let i = 0; i < Math.min(rows.length, items.length); i++) {
        await fillDateControls(rows[i], [items[i].startDate, items[i].endDate]);
      }
    }
    const graduation = [...document.querySelectorAll('[class*="apply-field-"]')]
      .find(e => e.querySelector('[class^="title-"]')?.textContent.trim() === '毕业时间');
    if (graduation) await fillDateControls(graduation, [profile.basicInfo?.graduationDate]);
    return count;
  }

  function isYearControl(el) {
    if (el.tagName === 'SELECT') {
      const years = [...el.options].filter((o) => /^(19|20)\d{2}/.test((o.value || o.text).trim()));
      return years.length >= 5;
    }
    const hint = `${el.placeholder || ''} ${el.getAttribute('aria-label') || ''} ${getClosestLabelText(el)}`.trim();
    if (/^年$|年份/.test(hint)) return true;
    const wrap = el.closest('.ant-select, .el-select, .rc-select');
    const shown = wrap ? wrap.textContent.replace(/\s+/g, ' ').trim().slice(0, 8) : '';
    return /^(年|年份|(19|20)\d{2})$/.test(shown);
  }

  function isMonthControl(el) {
    if (el.tagName === 'SELECT') {
      const months = [...el.options].filter((o) => {
        const n = parseInt(o.value || o.text, 10);
        return n >= 1 && n <= 12;
      });
      return months.length >= 12 && !isYearControl(el);
    }
    const hint = `${el.placeholder || ''} ${el.getAttribute('aria-label') || ''} ${getClosestLabelText(el)}`.trim();
    if (/^月$|月份/.test(hint)) return true;
    const wrap = el.closest('.ant-select, .el-select, .rc-select');
    const shown = wrap ? wrap.textContent.replace(/\s+/g, ' ').trim().slice(0, 6) : '';
    return /^(月|月份|\d{1,2}月?)$/.test(shown) && !isYearControl(el);
  }

  async function fillYearMonthWidgets(profile) {
    if (isMokaForm()) return fillMokaDates(profile);
    const controls = [...document.querySelectorAll(
      'select, [role="combobox"], input[placeholder="年"], input[placeholder="月"], input[placeholder="年份"], input[placeholder="月份"]'
    )].filter((el) => {
      if (isIgnoredInput(el) || !isElementTrulyVisible(el)) return false;
      if (el.closest('#job-autofill-dock, #job-autofill-copy-panel, #job-autofill-ai-panel, #job-autofill-log-panel')) return false;
      return isYearControl(el) || isMonthControl(el);
    });
    if (!controls.length) return 0;

    const edu = profile.education || [];
    const work = profile.workExperience || [];
    const proj = profile.projects || [];
    const counters = { edu: 0, work: 0, project: 0 };
    let filled = 0;
    let i = 0;

    while (i < controls.length) {
      const el = controls[i];
      const kind = nearestSectionKind(el) || 'edu';
      let source = null;
      if (kind === 'birth') {
        source = parseYearMonth(profile.basicInfo?.birthDate);
        if (isYearControl(el) && source.year) {
          if (!fieldHasValue(el) && await fillField(el, source.year)) filled++;
        } else if (isMonthControl(el) && source.month) {
          if (!fieldHasValue(el) && await fillField(el, source.month)) filled++;
        }
        i++;
        continue;
      }

      const list = kind === 'work' ? work : kind === 'project' ? proj : edu;
      const idx = counters[kind] || 0;
      const item = list[idx];
      if (!item) {
        i++;
        continue;
      }
      const start = parseYearMonth(item.startDate);
      const end = parseYearMonth(item.endDate);

      const group = [el];
      const elTop = el.getBoundingClientRect().top;
      while (i + group.length < controls.length) {
        const next = controls[i + group.length];
        if (nearestSectionKind(next) !== nearestSectionKind(el)) break;
        if (Math.abs(next.getBoundingClientRect().top - elTop) > 28) break;
        group.push(next);
        if (group.length >= 4) break;
      }

      const seq = group.length >= 4
        ? [start.year, start.month, end.year, end.month]
        : [start.year, start.month];
      for (let g = 0; g < group.length && g < seq.length; g++) {
        if (seq[g] && !fieldHasValue(group[g]) && await fillField(group[g], seq[g])) filled++;
      }
      counters[kind] = idx + 1;
      i += group.length;
    }

    return filled;
  }

  let activeDeclarationQuestions = new Set();
  function isProtectedQuestion(label) {
    if (activeDeclarationQuestions.has(exactQuestion(label))) return true;
    return /亲属.*(任职|退休|工作)|境外.*(身份|居留|就业|定居)|外国公民|香港.*台湾|国（境）外|国籍.*(其他|外国)|违法|违纪|犯罪|处分|失信|利益冲突|声明|承诺|签名|签字|本人确认|本人同意|真实性/.test(label);
  }

  function markManual(input, value) {
    input.setAttribute('data-job-autofill-manual', value);
    input.title = `请手动确认：${value}`;
    const root = input.closest('.form-item--phoenix, .ant-form-item, [class*="apply-field-"], .form-group') || input.parentElement;
    let note = root.querySelector('.job-autofill-manual-hint');
    if (!note) { note = document.createElement('small'); note.className = 'job-autofill-manual-hint'; root.append(note); }
    note.textContent = `请手动确认：${value}`;
    note.style.color = '#a65b00';
  }

  function exactQuestion(text) {
    return String(text || '').replace(/[\s*＊:：?？。]/g, '').toLowerCase();
  }

  function questionContainer(input) {
    return input.closest('.form-item--phoenix, .ant-form-item, [class*="apply-field-"], fieldset, .form-group') || input.parentElement;
  }

  function questionAnswered(root) {
    return !!root.querySelector('input:checked, .phoenix-radio--checked, .ant-radio-wrapper-checked, [aria-checked="true"]') ||
      [...root.querySelectorAll('input:not([type=radio]):not([type=checkbox]):not([type=hidden]),textarea,select')].some(fieldHasValue);
  }

  async function confirmDeclarations(items) {
    return new Promise(resolve => {
      const dialog = document.createElement('dialog');
      dialog.id = 'job-autofill-declaration-confirm';
      dialog.style.cssText = 'max-width:640px;max-height:80vh;overflow:auto;padding:24px;border:1px solid #ddd;border-radius:14px;background:white;color:#222;';
      const title = document.createElement('h3'); title.textContent = '确认本次个人声明'; dialog.append(title);
      for (const item of items) {
        const text = document.createElement('p');
        text.textContent = `当前问题：${item.question}\n保存答案：${item.saved.answer}${item.saved.explanation ? '；' + item.saved.explanation : ''}\n适用企业：${item.saved.company}`;
        text.style.whiteSpace = 'pre-wrap'; dialog.append(text);
      }
      for (const [text, result] of [['取消', false], ['确认填写以上答案', true]]) {
        const button = document.createElement('button'); button.textContent = text; button.style.margin = '8px';
        button.onclick = () => { dialog.close(); dialog.remove(); resolve(result); }; dialog.append(button);
      }
      dialog.addEventListener('cancel', () => { dialog.remove(); resolve(false); });
      document.body.append(dialog); dialog.showModal();
    });
  }

  async function fillConfirmedDeclarations(profile) {
    if (!(isBeisenForm() || isXhsForm() || isMokaForm())) return;
    const company = isBeisenForm() ? '中国人寿' : isXhsForm() ? '小红书' : '三七互娱';
    const items = [], seen = new Set();
    for (const input of document.querySelectorAll('input,select,textarea')) {
      if (input.disabled || !isElementTrulyVisible(input)) continue;
      const root = questionContainer(input);
      if (seen.has(root)) continue;
      seen.add(root);
      const question = getClosestLabelText(input);
      if (!question || /承诺|签名|签字|本人确认|本人同意|真实性/.test(question) || questionAnswered(root)) continue;
      const saved = (profile.declarations || []).find(item => exactQuestion(item.question) === exactQuestion(question) &&
        item.company === company && item.hostname?.toLowerCase() === location.hostname && ['是', '否'].includes(item.answer));
      if (saved) items.push({ input, root, question, saved });
    }
    if (!items.length || !await confirmDeclarations(items)) return;
    for (const { input, root, question, saved } of items) {
      if (!input.isConnected || questionAnswered(root) || exactQuestion(getClosestLabelText(input)) !== exactQuestion(question)) continue;
      const radios = [...root.querySelectorAll('.phoenix-radio, .ant-radio-wrapper, label')];
      const choice = radios.find(el => el.textContent.trim() === saved.answer && (el.querySelector('input[type=radio]') || el.matches('.phoenix-radio')));
      let success;
      if (choice) {
        choice.click(); await sleep(100);
        success = questionAnswered(root);
      } else success = await fillSiteControl(input, saved.answer);
      if (!success || saved.explanation) markManual(input, `${saved.answer}${saved.explanation ? '；补充说明：' + saved.explanation : ''}`);
    }
  }

  async function fillBeisenDate(input, value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split('-').map(Number);
    input.click();
    const panel = () => [...document.querySelectorAll('.phoenix-calendar')].find(isElementTrulyVisible);
    await sleep(100);
    let picked = false;
    for (let step = 0; step < 120; step++) {
      const calendar = panel();
      if (!calendar) break;
      const shownYear = parseInt(calendar.querySelector('.phoenix-calendar-year-select')?.textContent, 10);
      const shownMonth = parseInt(calendar.querySelector('.phoenix-calendar-month-select')?.textContent, 10);
      if (!shownYear || !shownMonth) break;
      if (shownYear === year && shownMonth === month) {
        const cell = [...calendar.querySelectorAll('.phoenix-calendar-cell:not(.phoenix-calendar-last-month-cell):not(.phoenix-calendar-next-month-btn-day) .phoenix-calendar-date')]
          .find(el => Number(el.textContent) === day && el.getAttribute('aria-disabled') !== 'true');
        if (cell) { cell.click(); picked = true; }
        break;
      }
      const direction = shownYear !== year ? (shownYear > year ? 'prev-year' : 'next-year') : (shownMonth > month ? 'prev-month' : 'next-month');
      const button = calendar.querySelector(`.phoenix-calendar-${direction}-btn`);
      if (!button) break;
      button.click(); await sleep(45);
    }
    document.body.click(); input.blur(); await sleep(80);
    const displayed = input.closest('.phoenix-select')?.querySelector('.phoenix-select__tipEle')?.textContent.trim() || input.value;
    return picked && displayed?.replace(/\//g, '-') === value;
  }

  async function fillSiteControl(input, value) {
    if (input.closest('.ant-form-item') && isXhsForm()) return fillXhsControl(input, value);
    if (isBeisenForm() && /^\d{4}-\d{2}(?:-\d{2})?$/.test(String(value)) && /日期|时间|年月/.test(getClosestLabelText(input))) return fillBeisenDate(input, value);
    if (input.closest('.phoenix-select') && isBeisenForm()) return fillBeisenSelect(input, value);
    const datePicker = input.closest('.phoenix-datePicker, .phoenix-datepicker, [class*="date-picker"], [class*="datePicker"]');
    if (datePicker) return false; // 未知日期组件不能把文本写入当成控件提交。
    return fillField(input, value);
  }

  // 只按当前条目容器取值；无条目容器时不猜测第几段经历。
  function extendedEntry(input, profile) {
    const phoenix = input.closest('.ux-standard-form');
    if (phoenix && isBeisenForm()) {
      const kind = beisenKind(phoenix);
      const section = { education: 'education', work: 'workExperience', project: 'projects', award: 'awards', family: 'familyMembers', paper: 'papers', patent: 'patents', certificate: 'certificates' }[kind];
      const index = [...document.querySelectorAll('.ux-standard-form')].filter(form => beisenKind(form) === kind).indexOf(phoenix);
      return { section, entry: profile[section]?.[index] };
    }
    if (isXhsForm()) {
      const card = input.closest('.rounded-md');
      const anchors = { '论文名称': 'papers', '竞赛/奖项名称': 'awards', '专利名称': 'patents', '证书名称': 'certificates' };
      const anchor = Object.keys(anchors).find(name => [...(card?.querySelectorAll('.ant-form-item-label') || [])].some(label => label.textContent.trim() === name));
      if (anchor) {
        const cards = [...document.querySelectorAll('.rounded-md')].filter(row => [...row.querySelectorAll('.ant-form-item-label')].some(label => label.textContent.trim() === anchor));
        const section = anchors[anchor];
        return { section, entry: profile[section]?.[cards.indexOf(card)] };
      }
      const match = input.id.match(/(resumeEducationInfo|resumeEmploymentInfo)_(\d+)_/);
      if (match) { const section = {resumeEducationInfo:'education',resumeEmploymentInfo:'workExperience',resumeAwardInfo:'awards',resumePaperInfo:'papers',resumePatentInfo:'patents'}[match[1]]; return { section, entry: profile[section]?.[Number(match[2])] }; }
    }
    if (isMokaForm()) {
      const block = input.closest('[data-nav-id]');
      const section = { 'block-educationInfo': 'education', 'block-projectInfo': 'projects', 'block-familyInfo': 'familyMembers', 'block-awardInfo': 'awards', 'block-paperInfo': 'papers', 'block-patentInfo': 'patents' }[block?.dataset.navId];
      const row = input.closest('[class*="apply-fields-"]');
      if (section && row) return { section, entry: profile[section]?.[[...block.children].filter(child => child.matches('[class*="apply-fields-"]')).indexOf(row)] };
    }
    const row = input.closest('[data-profile-section][data-entry-index]');
    if (row) return { section: row.dataset.profileSection, entry: profile[row.dataset.profileSection]?.[Number(row.dataset.entryIndex)] };
    return {};
  }

  async function fillExtendedFields(profile) {
    if (!(isBeisenForm() || isXhsForm() || isMokaForm() || ['localhost', '127.0.0.1'].includes(location.hostname))) return 0;
    const mappings = {
      education: { '学位':'academicDegree', '第二专业':'secondMajor', '辅修专业':'secondMajor', '学校所在城市':'schoolCity', '导师':'advisor', '实验室':'laboratory', '研究方向':'researchArea', '是否全日制':'fullTime', '全日制':'fullTime', '是否最高全日制学历':'highestFullTime', '最高全日制学历':'highestFullTime', '主修状态':'majorStatus', '是否主修':'majorStatus' },
      projects: { '项目级别':'projectLevel', '项目类型':'projectType' },
      awards: { '颁奖单位':'issuer', '名次':'rank', '获奖名次':'rank', '说明':'description', '获奖说明':'description', '其他补充':'description', '链接':'url', '担当角色':'role', '获奖时间':'date', '获奖日期':'date' },
      familyMembers: { '出生日期':'birthDate', '出生年月':'birthDate' },
      papers: { '论文名称':'name', '文章名、书名':'name', '名称':'name', '发表日期':'date', '发表时间':'date', '日期':'date', '期刊/会议或出版社':'publisher', '期刊名称':'publisher', '出版社':'publisher', '发布渠道':'publisher', '刊物、出版社':'publisher', '作者顺序':'authorOrder', '担当角色':'role', '摘要':'abstract', '论文摘要':'abstract', '内容摘要':'abstract', '担任角色':'role', '链接':'url' },
      patents: { '专利名称':'name', '名称':'name', '专利人':'inventor', '取得日期':'date', '获得时间':'date', '说明':'description', '链接':'url' },
      certificates: { '证书名称':'name', '证书编号':'code', '颁发机构':'issuer', '取得日期':'date', '有效期至':'expiryDate', '获得时间':'date' }
    };
    const basic = { '国籍':'nationality', '生源地':'sourcePlace', '生源地(高考时户口所在地)':'sourcePlace', '户籍地':'registeredAddress', '户籍所在地':'registeredAddress', '入党团时间':'politicalJoinDate', '入团时间':'leagueJoinDate', '入团日期':'leagueJoinDate', '加入共青团时间':'leagueJoinDate', '入党时间':'partyJoinDate', '入党日期':'partyJoinDate', '加入中国共产党时间':'partyJoinDate', '身高':'height', '身高(cm)':'height', '身高（cm）':'height', '体重':'weight', '体重(公斤)':'weight', '体重（kg）':'weight', '健康状况':'health' };
    const job = { '是否服从调剂':'acceptAdjustment', '是否接受县级公司工作':'acceptCounty', '是否愿意去县级公司工作':'acceptCounty', '币种':'salaryCurrency', '薪资币种':'salaryCurrency', '金额单位':'salaryUnit', '薪资周期':'salaryPeriod' };
    const answers = { '游戏经历':'gameExperience', '编程语言':'programmingLanguages', '请列出你最擅长的3门编程语言，并按熟悉程度从高到低排序。':'programmingLanguages', 'ai工具使用经历':'aiTools', 'ai 工具使用经历':'aiTools', '爱好特长':'hobbies', '爱好及特长':'hobbies', '优势不足':'strengthsWeaknesses', '优势与不足':'strengthsWeaknesses', '自我评价':'selfEvaluation', '求职目标':'careerGoal' };
    let count = 0;
    for (const input of document.querySelectorAll('input:not([type=file]):not([type=hidden]):not([type=checkbox]),textarea,select')) {
      if (isIgnoredInput(input) || !isElementTrulyVisible(input) || fieldHasValue(input)) continue;
      const label = getClosestLabelText(input);
      if (!label || isProtectedQuestion(label)) continue;
      const { section, entry } = extendedEntry(input, profile);
      let value = section ? entry?.[mappings[section]?.[label]] : profile.basicInfo?.[basic[label]] || profile.jobIntention?.[job[label]] || profile.commonAnswers?.[answers[label]];
      if (!value && !section) value = (profile.customAnswers || []).find(item => exactQuestion(item.question) === exactQuestion(label) && !isProtectedQuestion(item.question))?.answer;
      if (section === 'awards' && label === '获奖情况描述/链接') value = [entry?.description, entry?.url].filter(Boolean).join('\n');
      if (section === 'patents' && label === '专利描述/链接') value = [entry?.description, entry?.url].filter(Boolean).join('\n');
      if (!section && label === '自我评价及求职目标') value = [profile.commonAnswers?.selfEvaluation, profile.commonAnswers?.careerGoal].filter(Boolean).join('\n') || profile.introTemplates?.default;
      if (!section && label === '期望待遇（万元/年）') {
        const salary = profile.jobIntention || {};
        if (salary.expectedSalary && (!/^(人民币|CNY|RMB)$/.test(salary.salaryCurrency) || salary.salaryUnit !== '万元' || salary.salaryPeriod !== '年薪')) {
          markManual(input, `${salary.expectedSalary}（请确认币种、万元单位和年薪周期）`); continue;
        }
        value = salary.expectedSalary;
      }
      if (Array.isArray(value)) value = value.join('\n');
      if (!value) continue;
      if (/日期|时间/.test(label) && /^\d{4}-\d{2}$/.test(value) && (isBeisenForm() || input.type === 'date')) {
        markManual(input, `${value}（请确认具体日期）`); continue;
      }
      if (await fillSiteControl(input, value)) count++;
      else markManual(input, value);
    }
    return count;
  }

  // 附件仅按明确用途选择，设置 input.files 不代表网站已接收。
  async function handleResumeUpload(profile) {
    for (const input of document.querySelectorAll('input[type="file"]')) {
      if (input.disabled || input.files?.length || input.dataset.capybaraFileSelected) continue;
      const label = getClosestLabelText(input);
      const kinds = [
        ['resume', /简历附件|附件简历|上传简历|^简历$|\bresume\b|\bcv\b/i],
        ['idPhoto', /证件照|标准照/], ['lifePhoto', /生活照/], ['works', /作品附件|上传作品|作品集附件/]
      ].filter(([, pattern]) => pattern.test(label));
      if (kinds.length !== 1) continue;
      const kind = kinds[0][0];
      const refs = kind === 'works' ? profile.attachments?.works || [] : [profile.attachments?.[kind]].filter(Boolean);
      try {
        const candidates = [];
        for (const ref of refs) {
          const response = await runtimeSend({ action: 'getAttachment', profileId: profile.id, id: ref.id });
          if (!response?.success) throw new Error(response?.error || '附件读取失败');
          candidates.push(response.file);
        }
        if (kind === 'resume' && !candidates.length && profile.resumeFile) candidates.push({ name: profile.resumeFileName || 'resume.pdf', dataUrl: profile.resumeFile });
        const transfer = new DataTransfer();
        for (const candidate of candidates) {
          const blob = await (await fetch(candidate.dataUrl)).blob();
          const file = new File([blob], candidate.name, { type: blob.type });
          const accepted = input.accept.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
          if (/Photo$/.test(kind) && !file.type.startsWith('image/')) continue;
          if (accepted.length && !accepted.some(type => type === file.type || (type.startsWith('.') && file.name.toLowerCase().endsWith(type)) || (type.endsWith('/*') && file.type.startsWith(type.slice(0, -1))))) continue;
          transfer.items.add(file);
          if (!input.multiple) break;
        }
        if (!transfer.files.length) continue;
        input.files = transfer.files;
        input.dataset.capybaraFileSelected = 'true';
        input.dispatchEvent(new Event('change', { bubbles: true }));
        markManual(input, '已选择附件，请核对网站是否接收；重新上传请在网站手动操作');
      } catch (error) { markManual(input, error.message); }
    }
  }

  // ========================================================================
  // AI 逐步智能解析与深度填表引擎 (AI Step-by-Step Deep Filler)
  // ========================================================================

  const LONG_FIELD_TYPES = new Set([
    'projectDescription', 'projectResponsibilities', 'projectAchievements',
    'workDescription', 'workAchievements', 'introduction', 'skills', 'awards', 'courses'
  ]);
  const PROJECT_LONG_FIELD_TYPES = new Set(['projectDescription', 'projectResponsibilities', 'projectAchievements']);
  const WORK_LONG_FIELD_TYPES = new Set(['workDescription', 'workAchievements']);
  const OPEN_LABEL_RE = /描述|职责|成果|总结|评价|动机|原因|介绍|问答|理由|难点|优势|规划|说明|详述|开放|为什么|自我|请|是否|谈谈|列出|分享|经历|看法|如何|什么|哪些|使用/;
  const SHORT_LABEL_RE = /姓名|名字|手机|电话|邮箱|性别|民族|政治面貌|籍贯|生源地|户籍|身份证|证件|出生|生日|学校|学院|专业|学历|学位|绩点|排名|年级|入学|毕业|起止|时间|日期|城市|薪资|岗位|到岗|推荐码|内推码|公司名称|职位名称|项目名称|链接|网址|url|年|月|日/i;
  const AI_FIELD_SELECTOR = 'textarea, input[type="text"], input:not([type]), div[contenteditable="true"]';
  let aiFillRunning = false;

  function isElementTrulyVisible(el) {
    if (!el || el.disabled) return false;
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.visibility === 'collapse' || style.display === 'none') return false;
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) return true;
    return el.getClientRects && el.getClientRects().length > 0;
  }

  function fieldHasValue(el) {
    if (el.type === 'radio' || el.type === 'checkbox') return !!questionContainer(el).querySelector('input:checked, [aria-checked="true"], .phoenix-radio--checked, .ant-radio-wrapper-checked');
    const phoenix = el.closest('.phoenix-select');
    if (phoenix) return !!phoenix.querySelector('.phoenix-select__tipEle')?.textContent.trim();
    if (el.isContentEditable) return !!(el.textContent || '').trim();
    const mokaSelect = el.closest('[class*="sd-Select-container-"]');
    if (mokaSelect) return !!mokaSelect.querySelector('[class*="sd-Input-display-value-"]')?.textContent.trim();
    if (el.tagName === 'SELECT') {
      const option = el.options[el.selectedIndex];
      return !!option && !!el.value && !/^(请选择.*|请选择|please\s+select.*|select(?:\s.*)?|年|月|日|[-—]+)$/i.test(option.text.trim());
    }
    if ((el.value || '').trim()) return true;
    const wrap = el.closest('.ant-select, .el-select, .rc-select');
    if (wrap) {
      const item = wrap.querySelector('.ant-select-selection-item, .el-select__selected-item, .rc-select-selection-item');
      const text = (item && item.textContent.trim()) || '';
      if (text && !/^(请选择|年|月|日)$/.test(text)) return true;
    }
    return false;
  }

  function isOpenQuestionField(el) {
    if (isProtectedQuestion(getClosestLabelText(el)) || /是否|国籍|身份|籍贯|生源|户籍|婚姻|政治|健康|家庭|亲属|薪资|调剂|县级|意愿|偏好|游戏经历|编程语言|爱好|特长/.test(getClosestLabelText(el))) return false;
    if (isBeisenForm() || isXhsForm()) return false; // 此类表单包含个人声明；仅使用资料的确定性分区映射。
    if (isSelectWidget(el) || isYearControl(el) || isMonthControl(el)) return false;
    if (el.closest('.ant-select, .el-select, .rc-select')) return false;
    const type = matchFieldType(el);
    if (type && !LONG_FIELD_TYPES.has(type)) return false;
    const label = getClosestLabelText(el);
    if (SHORT_LABEL_RE.test(label) && !OPEN_LABEL_RE.test(label)) return false;
    const maxLen = parseInt(el.getAttribute('maxlength') || '0', 10);
    if (maxLen > 0 && maxLen <= 40) return false;
    const height = el.getBoundingClientRect().height;
    const multiline = el.tagName === 'TEXTAREA' || el.isContentEditable;
    if (OPEN_LABEL_RE.test(label) && (multiline || height >= 48)) return true;
    if (type && LONG_FIELD_TYPES.has(type)) return true;
    if (multiline && (maxLen === 0 || maxLen > 40)) return true;
    return false;
  }

  function listAiQuestionFields(emptyOnly) {
    return [...document.querySelectorAll(AI_FIELD_SELECTOR)].filter((el) => {
      if (isIgnoredInput(el)) return false;
      if (!el.isConnected || !isElementTrulyVisible(el)) return false;
      if (emptyOnly && fieldHasValue(el)) return false;
      return isOpenQuestionField(el);
    });
  }

  function aiFieldSignature(el) {
    return [
      el.tagName.toLowerCase(),
      el.getAttribute('type') || '',
      getClosestLabelText(el),
      el.getAttribute('placeholder') || '',
      el.getAttribute('maxlength') || '',
      nearestSectionKind(el)
    ].join('|');
  }

  function structuredSectionKind(fieldType, el) {
    if (PROJECT_LONG_FIELD_TYPES.has(fieldType)) return 'project';
    if (WORK_LONG_FIELD_TYPES.has(fieldType)) return 'work';
    return '';
  }

  function experienceIndexForField(el, kind) {
    const markerType = kind === 'project' ? 'projectName' : kind === 'work' ? 'company' : '';
    if (!markerType) return 0;

    const controls = document.querySelectorAll('input, textarea, select, [role="combobox"]');
    let index = -1;
    for (const control of controls) {
      if (isIgnoredInput(control)) continue;
      if (matchFieldType(control) === markerType) index++;
      if (control === el) return Math.max(index, 0);
    }
    return Math.max(index, 0);
  }

  function snapshotAiQuestionFields() {
    const fields = listAiQuestionFields(false);
    const signatureCounts = new Map();
    const nameCounts = new Map();

    return fields.map((el, position) => {
      const fieldType = matchFieldType(el);
      const sectionKind = structuredSectionKind(fieldType, el);
      const signature = aiFieldSignature(el);
      const ordinal = signatureCounts.get(signature) || 0;
      signatureCounts.set(signature, ordinal + 1);

      const name = el.getAttribute('name') || '';
      const nameKey = `${el.tagName}|${name}`;
      const nameOrdinal = nameCounts.get(nameKey) || 0;
      nameCounts.set(nameKey, nameOrdinal + 1);

      if (fieldHasValue(el)) return null;

      return {
        id: el.id || '',
        name,
        nameOrdinal,
        signature,
        ordinal,
        position,
        tagName: el.tagName,
        fieldType,
        sectionKind,
        experienceIndex: experienceIndexForField(el, sectionKind),
        label: getClosestLabelText(el) || el.placeholder || '开放问答题',
        placeholder: el.placeholder || '',
        maxLength: el.getAttribute('maxlength') || ''
      };
    }).filter(Boolean);
  }

  function resolveAiQuestionField(ref) {
    const isUsable = (el) => el && el.isConnected && isElementTrulyVisible(el) && isOpenQuestionField(el);

    if (ref.id) {
      const byId = document.getElementById(ref.id);
      if (isUsable(byId)) return byId;
    }

    const fields = listAiQuestionFields(false);
    if (ref.name) {
      const named = fields.filter((el) => el.tagName === ref.tagName && el.getAttribute('name') === ref.name);
      if (named[ref.nameOrdinal]) return named[ref.nameOrdinal];
    }

    const matching = fields.filter((el) => aiFieldSignature(el) === ref.signature);
    if (matching[ref.ordinal]) return matching[ref.ordinal];

    const positional = fields[ref.position];
    return positional && positional.tagName === ref.tagName ? positional : null;
  }

  function readFieldValue(el) {
    if (!el) return '';
    if (el.isContentEditable) return (el.textContent || '').trim();
    return String(el.value || '').trim();
  }

  function normalizeIdentity(value) {
    return String(value || '').toLowerCase().replace(/[\s·_\-—–|（）()【】\[\]]+/g, '');
  }

  function localExperienceIdentity(el, kind) {
    const markerType = kind === 'project' ? 'projectName' : 'company';
    const secondaryType = kind === 'work' ? 'position' : 'projectRole';
    let node = el?.parentElement;

    for (let depth = 0; depth < 8 && node; depth++, node = node.parentElement) {
      const controls = [...node.querySelectorAll('input, textarea, select, [role="combobox"]')];
      const markers = controls.filter((control) => matchFieldType(control) === markerType);
      if (markers.length !== 1) continue;
      const marker = markers[0];
      const secondary = controls.find((control) => matchFieldType(control) === secondaryType);
      return {
        primary: readFieldValue(writableBox(marker) || marker),
        secondary: readFieldValue(writableBox(secondary) || secondary)
      };
    }
    return { primary: '', secondary: '' };
  }

  function resolveStructuredResumeContext(profile, ref, liveField) {
    const kind = ref.sectionKind;
    if (kind !== 'project' && kind !== 'work') return { required: false, item: null };

    const items = kind === 'project'
      ? (profile.projects || []).filter((item) => item && [item.name, item.description, item.responsibilities, item.achievements].some((value) => String(value || '').trim()))
      : (profile.workExperience || []).filter((item) => item && [item.company, item.position, item.description, item.achievements].some((value) => String(value || '').trim()));
    const identity = localExperienceIdentity(liveField, kind);
    const primary = normalizeIdentity(identity.primary);
    const matched = primary
      ? items.find((item) => {
          const itemPrimary = normalizeIdentity(kind === 'project' ? item.name : item.company);
          return itemPrimary && (itemPrimary.includes(primary) || primary.includes(itemPrimary));
        })
      : null;
    const item = matched || items[ref.experienceIndex] || null;
    if (!item) return { required: true, item: null, reason: `简历中没有第 ${ref.experienceIndex + 1} 段${kind === 'project' ? '项目' : '工作/实习'}经历` };

    const parts = kind === 'project' ? smartExtractProjectParts(item) : smartExtractWorkParts(item);
    let sourceText = '';
    if (ref.fieldType === 'projectResponsibilities') sourceText = parts.responsibilities;
    else if (ref.fieldType === 'projectDescription') sourceText = parts.description;
    else if (ref.fieldType === 'projectAchievements') sourceText = parts.achievements;
    else if (ref.fieldType === 'workDescription') sourceText = parts.description;
    else if (ref.fieldType === 'workAchievements') sourceText = parts.achievements;

    if (!String(sourceText || '').trim()) {
      return {
        required: true,
        item: null,
        reason: `对应${kind === 'project' ? '项目' : '工作/实习'}经历没有填写该项原始内容`
      };
    }

    return {
      required: true,
      item,
      kind,
      title: kind === 'project' ? item.name : [item.company, item.position].filter(Boolean).join(' / '),
      context: kind === 'project'
        ? { name: item.name, role: item.role, description: parts.description, responsibilities: parts.responsibilities, achievements: parts.achievements, techStack: parts.techStack }
        : { company: item.company, position: item.position, description: parts.description, achievements: parts.achievements }
    };
  }

  async function writeAndVerifyAiAnswer(ref, answer) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const liveField = resolveAiQuestionField(ref);
      if (!liveField) return { success: false, reason: '字段已被页面重建且无法重新定位' };
      if (attempt === 0 && fieldHasValue(liveField)) {
        return { success: false, reason: '字段在 AI 生成期间已被填写' };
      }

      const box = writableBox(liveField) || liveField;
      const ok = await fillField(box, answer);
      if (ok) {
        try { box.blur(); } catch {}
      }
      await sleep(400);

      const currentField = resolveAiQuestionField(ref);
      const currentBox = writableBox(currentField) || currentField;
      const writtenValue = readFieldValue(currentBox);
      if (writtenValue) return { success: true, field: currentBox, value: writtenValue };
    }

    return { success: false, reason: '页面更新后字段值未保留' };
  }

  function checkAnswerQuality(answer, fieldType, labelText) {
    const warnings = [];
    const text = String(answer || '').trim();

    if (text.length < 30) {
      warnings.push('内容过短');
    }

    // 检查是否是职责类字段
    const isResponsibilityField = fieldType === 'projectResponsibilities' ||
                                   fieldType === 'workDescription' ||
                                   /职责|负责|工作内容/i.test(labelText);

    if (isResponsibilityField) {
      // 检查是否有分点
      const hasBulletPoints = /^[●•\-*]\s/m.test(text) || /^\d+[\.\)]\s/m.test(text);
      if (!hasBulletPoints && text.length > 80) {
        warnings.push('职责类字段建议分点列出');
      }

      // 检查是否包含量化数据
      const hasQuantification = /\d+%|\d+\+|准确率|QPS|TPS|毫秒|万条|亿|降低|提升|优化|达到/i.test(text);
      if (!hasQuantification) {
        warnings.push('缺少量化指标（建议补充准确率、性能数据等）');
      }

      // 检查是否包含技术栈
      const hasTechStack = /[A-Z][a-z]+|BERT|GPT|API|SQL|LLM|Agent|RAG|模型|微调|框架/i.test(text);
      if (!hasTechStack) {
        warnings.push('建议明确提及使用的技术栈');
      }
    }

    // 检查空洞词汇
    const fluffWords = ['负责', '参与', '协助', '配合', '学习', '了解', '熟悉'];
    const fluffCount = fluffWords.filter(word => text.includes(word)).length;
    if (fluffCount > 2 && !/具体|实现|构建|开发|设计/i.test(text)) {
      warnings.push('表述较空洞，建议增加具体工作内容');
    }

    return {
      isGood: warnings.length === 0,
      warnings: warnings,
      score: Math.max(0, 100 - warnings.length * 25)
    };
  }

  function slimResumeContext(profile) {
    return {
      name: profile.basicInfo?.fullName,
      school: profile.education?.[0]?.school,
      major: profile.education?.[0]?.major,
      degree: profile.education?.[0]?.degree,
      skills: profile.skills?.skills || profile.skills,
      advantage: profile.skills?.advantage,
      intro: profile.introTemplates?.default || profile.skills?.intro,
      projects: (profile.projects || []).slice(0, 3).map((p) => ({
        name: p.name,
        role: p.role,
        techStack: p.techStack,
        description: (p.description || '').slice(0, 500),
        responsibilities: (p.responsibilities || '').slice(0, 600),
        achievements: (p.achievements || '').slice(0, 300)
      })),
      workExperience: (profile.workExperience || []).slice(0, 2).map((w) => ({
        company: w.company,
        position: w.position,
        description: (w.description || '').slice(0, 500),
        achievements: (w.achievements || '').slice(0, 300)
      })),
      awards: profile.awards
    };
  }

  function runtimeSend(payload, timeoutMs) {
    return new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve({ success: false, error: 'timeout' });
      }, timeoutMs || 15000);
      try {
        chrome.runtime.sendMessage(payload, (res) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (chrome.runtime.lastError) {
            resolve({ success: false, error: chrome.runtime.lastError.message });
            return;
          }
          resolve(res || { success: false });
        });
      } catch (err) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ success: false, error: err.message });
      }
    });
  }

  function askAi(prompt, systemPrompt, maxTokens) {
    return runtimeSend({
      action: 'aiGenerate',
      prompt,
      systemPrompt,
      maxTokens: maxTokens || 400
    }, 90000);
  }

  function showAiProgress(text) {
    let el = document.getElementById('job-autofill-ai-progress-badge');
    if (!el) {
      el = document.createElement('div');
      el.id = 'job-autofill-ai-progress-badge';
    }
    el.setAttribute('style', [
      'position:fixed',
      'top:18px',
      'left:50%',
      'transform:translateX(-50%)',
      'z-index:2147483647',
      'display:flex',
      'align-items:center',
      'gap:8px',
      'padding:10px 18px',
      'border-radius:999px',
      'background:#1e1b4b',
      'color:#f8fafc',
      'font-size:13px',
      'font-weight:650',
      'line-height:1.4',
      'box-shadow:0 10px 32px rgba(0,0,0,.4)',
      'pointer-events:none',
      'max-width:min(640px,calc(100vw - 24px))',
      'font-family:-apple-system,BlinkMacSystemFont,PingFang SC,sans-serif'
    ].join(';'));
    el.innerHTML = `<span class="ai-spinner">✨</span><span>${text}</span>`;
    (document.documentElement || document.body).appendChild(el);
    return el;
  }

  function hideAiProgress() {
    const el = document.getElementById('job-autofill-ai-progress-badge');
    if (el) el.remove();
  }

  function recordPageSubmission(profile) {
    cacheJobMetaFromPage();
    const company = detectCompanyName();
    const position = detectPositionName(profile, { allowProfileFallback: false });

    if (typeof appLog !== 'undefined') {
      appLog.info('content', 'submission.detect', '检测到投递信息', {
        company: company,
        position: position,
        url: window.location.href,
        profileName: profile.name || '默认资料'
      });
    }

    chrome.runtime.sendMessage({
      action: 'recordSubmission',
      data: {
        company,
        position,
        url: window.location.href,
        date: new Date().toISOString().slice(0, 10),
        profileId: profile.id || '',
        profileName: profile.name || '默认资料',
        status: '在投'
      }
    });
  }

  async function aiStepByStepFill(profile) {
    if (!profile) {
      showNotification('未找到可用简历资料，请先在配置中创建', 'warning');
      return { count: 0 };
    }
    if (aiFillRunning) {
      showNotification('AI 助填正在进行中，请稍候', 'info');
      return { count: 0 };
    }
    aiFillRunning = true;
    showAiProgress('正在填充基础字段…');

    try {
      cacheJobMetaFromPage();
      const fastFillRes = await fillForm(profile);

      const settingsRes = await runtimeSend({ action: 'getSettings' }, 8000);
      const settings = settingsRes?.settings || {};

      if (!settings.aiEnabled || !settings.aiApiKey) {
        hideAiProgress();
        showNotification(`⚡ 基础字段已填充 ${fastFillRes.filledCount} 项。如需 AI 解答开放题，请在插件配置中填入 API Key`, 'warning');
        return fastFillRes;
      }

      await sleep(500);
      const candidates = snapshotAiQuestionFields();
      if (typeof appLog !== 'undefined') {
        appLog.info('content', 'ai.candidates', `识别到 ${candidates.length} 道待填写开放题`, {
          fields: candidates.map((field) => ({
            label: field.label,
            maxLength: field.maxLength || null,
            fieldType: field.fieldType || null,
            section: field.sectionKind || null,
            experienceIndex: field.experienceIndex
          }))
        });
      }

      if (candidates.length === 0) {
        hideAiProgress();
        showNotification(`标准字段已填充 ${fastFillRes.filledCount} 项，当前没有需要 AI 写的开放题`, 'success');
        return { count: fastFillRes.filledCount };
      }

      showAiProgress(`准备解答 ${candidates.length} 道开放题…`);

      const posName = detectPositionName(profile);
      const compName = detectCompanyName();
      const resumeContext = JSON.stringify(slimResumeContext(profile));
      let aiFilledCount = 0;
      let manualAnswerCount = 0;

      for (let i = 0; i < candidates.length; i++) {
        const fieldRef = candidates[i];
        const promptField = resolveAiQuestionField(fieldRef);
        const labelText = fieldRef.label;
        const maxLength = fieldRef.maxLength;

        showAiProgress(`AI 正在写 (${i + 1}/${candidates.length})：${escapeHtml(labelText.slice(0, 28))}`);
        if (promptField) {
          promptField.scrollIntoView({ behavior: 'smooth', block: 'center' });
          promptField.classList.add('job-autofill-ai-focusing');
        }

        const structuredContext = resolveStructuredResumeContext(profile, fieldRef, promptField);
        // 游戏体验和个人熟练度排序需要本人确认，不能由项目经历推断。
        if (/游戏经历|游戏时长|氪金|编程语言.*(排序|熟悉程度)|最擅长.*编程语言/.test(labelText)) {
          manualAnswerCount++;
          promptField?.classList.remove('job-autofill-ai-focusing');
          if (typeof appLog !== 'undefined') appLog.info('content', 'ai.step_skip', `请本人填写: ${labelText}`);
          continue;
        }
        if (structuredContext.required && !structuredContext.item) {
          promptField?.classList.remove('job-autofill-ai-focusing');
          if (typeof appLog !== 'undefined') {
            appLog.warn('content', 'ai.step_skip', `跳过无对应简历来源的字段: ${labelText}`, {
              fieldType: fieldRef.fieldType,
              section: fieldRef.sectionKind,
              experienceIndex: fieldRef.experienceIndex,
              reason: structuredContext.reason
            });
          }
          continue;
        }

        let taskInstruction = '用 80-150 字回答，只写会填进输入框的正文。';
        if (fieldRef.fieldType === 'projectResponsibilities') {
          taskInstruction = `精准提取该项目中的个人职责，要求：
1. 列出3-4条核心职责，每条单独一行，以动词开头（如"构建"、"负责"、"实现"）
2. 每条职责必须包含：具体工作内容 + 使用的技术/方法 + 量化成果（如准确率、性能指标、处理量）
3. 严格使用简历中该项目已有的内容，不得引用其他项目
4. 保持专业技术描述，避免空洞表述
示例格式：
● 构建拒识模型，微调BERT-Tiny处理50万条语料，实现毫秒级响应与90%以上拒识率
● 基于DeepSeek与Function Calling实现意图匹配与槽位抽取，准确率达91%`;
        } else if (fieldRef.fieldType === 'workDescription') {
          taskInstruction = `精准提取该段工作/实习的核心职责，要求：
1. 列出3-4条主要职责，每条单独一行，以动词开头
2. 每条必须体现：具体负责的模块/功能 + 采用的技术方案 + 业务价值或量化指标
3. 严格基于简历中该段实习的原有内容，不得用项目经历替代
4. 突出实际落地工作，避免泛泛而谈
示例格式：
● 负责金融知识库构建，解析11588份年报（70GB），为RAG检索提供数据底座
● 基于LoRA微调GLM4-9B实现NL2SQL转换，生成准确率提升至82%`;
        } else if (/项目.*描述|项目.*介绍|项目.*内容/i.test(labelText)) {
          taskInstruction = `用80-120字精炼概括该项目，必须包含：
1. 项目背景与业务目标（1句话说明解决什么问题）
2. 核心技术方案（采用的关键技术栈）
3. 主要成果与业务价值（带数字的量化指标）
避免罗列职责，仅写项目整体概况。`;
        } else if (/项目.*职责|负责.*内容|个人.*分工/i.test(labelText)) {
          taskInstruction = `列出该项目中的个人具体职责，要求：
1. 写3-4条，每条单独一行，动词开头（构建/负责/实现/优化）
2. 体现：做了什么 + 用什么技术 + 达到什么效果
3. 必须有量化数据（准确率/延迟/并发量/数据规模等）
4. 突出个人核心贡献，不写团队整体工作`;
        } else if (/成果|成就|难点/i.test(labelText)) {
          taskInstruction = `提炼该经历的核心成果，要求：
1. 写2-3条量化成果，每条单独一行
2. 必须包含具体数字（准确率90%、延迟降低50ms、QPS达500+等）
3. 体现技术难点攻克或业务指标提升
4. 避免泛泛描述，每条都要有可验证的指标`;
        } else if (/自我评价|个人总结|个人优势/i.test(labelText)) {
          taskInstruction = `用80-120字总结个人核心竞争力，要求：
1. 突出技术栈深度（掌握的核心技术与框架）
2. 体现项目落地能力（独立完成过什么类型的系统）
3. 用量化数据支撑（处理过多少数据、达到什么指标）
4. 简洁专业，不写空话套话`;
        } else if (/动机|为什么/i.test(labelText)) {
          taskInstruction = `用80-120字说明申请动机，要求：
1. 结合「${compName}」的业务方向，说明个人技术与岗位的匹配点
2. 引用简历中的具体项目经验，说明如何能快速上手「${posName}」
3. 表达对该领域的兴趣与技术积累
4. 真诚专业，避免空洞表态`;
        }

        const fieldResumeContext = structuredContext.item
          ? JSON.stringify({ 对应经历类型: structuredContext.kind, 对应经历: structuredContext.context }, null, 2)
          : resumeContext;
        const groundingRule = structuredContext.item
          ? `【重要】本字段明确属于「${structuredContext.title}」。只能使用下面这一段对应经历，严禁引用其他项目或工作，严禁补充原材料中不存在的公司、岗位、职责或成果。\n`
          : '【重要】严格依据简历作答，不得虚构简历中不存在的经历、公司、岗位或成果。\n';

        const formatRequirement = (fieldRef.fieldType === 'projectResponsibilities' || fieldRef.fieldType === 'workDescription' || /职责|负责/i.test(labelText))
          ? '\n【输出格式】每条职责单独一行，以"●"或"•"开头，格式：● 动词+具体工作+技术方案+量化成果'
          : '\n【输出格式】流畅的段落文本，自然分段，不要使用列表符号';

        const userPrompt =
          `【任务】填写网申开放题\n` +
          '【资料不足】若简历没有题目要求的事实（如游戏经历、语言熟练度排序），只返回 [[NEEDS_USER_INPUT]]。不得把未提及写成“没有”，不得推断个人偏好或编造时长。能部分回答的题目只写已知事实。\n' +
          `【应聘岗位】${compName} - ${posName}\n` +
          `【题目】${labelText}\n` +
          (fieldRef.placeholder ? `【提示】${fieldRef.placeholder}\n` : '') +
          (maxLength ? `【字数限制】不超过 ${maxLength} 字\n` : '') +
          groundingRule +
          `【作答要求】\n${taskInstruction}\n` +
          formatRequirement + '\n' +
          `【可用简历材料】\n${fieldResumeContext}\n\n` +
          `请严格按照上述要求作答，只输出填入输入框的正文内容。`;

        const systemPrompt = `你是一个专业的网申填写助手。
核心要求：
1. 只输出可直接填入输入框的正文内容，不要标题、序号前缀、markdown格式
2. 必须严格基于提供的简历材料，不得虚构任何公司、岗位、技术或成果
3. 如果是项目职责/工作职责字段，每条职责必须包含：动作+技术+量化成果
4. 避免空洞表述，每个关键点都要有具体支撑（技术栈、数据量、性能指标）
5. 禁止跨项目混用内容，禁止把项目经历写成实习经历
6. 输出要简洁专业，符合技术岗位招聘的表达习惯`;

        try {
          const aiRes = await askAi(userPrompt, systemPrompt, 500);
          if (aiRes && aiRes.success && aiRes.text) {
            const answer = aiRes.text.trim().replace(/^```[\s\S]*?\n|```$/g, '').trim();
            if (answer.includes('[[NEEDS_USER_INPUT]]')) {
              manualAnswerCount++;
              if (typeof appLog !== 'undefined') appLog.info('content', 'ai.step_skip', `资料不足，待本人补充: ${labelText}`);
              continue;
            }
            if (answer) {
              const qualityCheck = checkAnswerQuality(answer, fieldRef.fieldType, labelText);
              const writeResult = await writeAndVerifyAiAnswer(fieldRef, answer);
              if (writeResult.success) {
                aiFilledCount++;
                writeResult.field.classList.add('job-autofill-ai-filled');
                if (typeof appLog !== 'undefined') {
                  const logLevel = qualityCheck.isGood ? 'success' : 'warn';
                  const logMessage = qualityCheck.isGood
                    ? `AI 已写入题目: ${labelText}`
                    : `AI 已写入题目: ${labelText}（质量评分: ${qualityCheck.score}/100）`;
                  appLog[logLevel]('content', 'ai.step_fill', logMessage, {
                    answer: answer.slice(0, 500),
                    writtenLength: writeResult.value.length,
                    matchedExperience: structuredContext.title || null,
                    qualityScore: qualityCheck.score,
                    qualityWarnings: qualityCheck.warnings
                  });
                }
              } else if (typeof appLog !== 'undefined') {
                appLog.warn('content', 'ai.step_fill_miss', `已生成但未能写入: ${labelText}`, {
                  answer: answer.slice(0, 200),
                  reason: writeResult.reason
                });
              }
            } else if (typeof appLog !== 'undefined') {
              appLog.warn('content', 'ai.step_generate_miss', `模型未生成可填写正文: ${labelText}`);
            }
          } else if (typeof appLog !== 'undefined') {
            appLog.warn('content', 'ai.step_generate_miss', `模型生成失败: ${labelText}`, {
              error: aiRes?.error || aiRes?.message || '返回正文为空'
            });
          }
        } catch (err) {
          console.error('[Capybara助手] AI 单步解析失败:', err);
          if (typeof appLog !== 'undefined') {
            appLog.error('content', 'ai.step_error', `AI生成异常: ${labelText}`, err.message);
          }
        } finally {
          promptField?.classList.remove('job-autofill-ai-focusing');
        }
        await sleep(200);
      }

      hideAiProgress();

      if (aiFilledCount > 0 || fastFillRes.filledCount > 0) {
        try { recordPageSubmission(profile); } catch {}
      }

      showNotification(`AI 助填完成：开放题 ${aiFilledCount} 项，基础字段 ${fastFillRes.filledCount} 项` +
        (manualAnswerCount ? `；${manualAnswerCount} 项资料不足，请本人填写` : ''), manualAnswerCount ? 'warning' : 'success');
      if (typeof appLog !== 'undefined') {
        appLog.success('content', 'ai.step_fill_done', `逐步解析完成，共解答 ${aiFilledCount} 项`, { url: location.href });
      }
      return { count: fastFillRes.filledCount + aiFilledCount };
    } finally {
      aiFillRunning = false;
      hideAiProgress();
    }
  }

  // ========================================================================
  // 悬浮挂件与高阶功能 (自由拖动 · 快捷小抄 · AI助手 · 字段高亮 · 资料切换)
  // ========================================================================

  const FIELD_LABELS = {
    fullName: '姓名', firstName: '名', lastName: '姓', middleName: '中间名',
    phone: '手机号码', phoneType: '手机类型', email: '电子邮箱', gender: '性别', birthDate: '出生日期', idCard: '身份证号',
    politicalStatus: '政治面貌', ethnicity: '民族', hometown: '籍贯', graduationDate: '毕业时间', maritalStatus: '婚姻状况', currentCity: '现居住城市',
    emergencyContact: '紧急联系人', emergencyRelation: '联系人关系', emergencyPhone: '联系人电话',
    expectedCity: '期望城市', expectedPosition: '期望岗位', expectedSalary: '期望薪资', availableDate: '到岗时间', referralCode: '内推码', recruitSource: '招聘渠道', willingToTravel: '是否可出差',
    cet4: '英语四级', cet6: '英语六级', ielts: '雅思成绩', toefl: '托福成绩', otherLanguages: '其他外语', awards: '荣誉奖项', certificates: '资格证书', certificateCode: '证书编号', certificateIssuer: '颁发机构', certificateDate: '取得日期', certificateExpiryDate: '有效期至',
    familyName: '家庭成员姓名', familyRelation: '亲属关系', familyEmployer: '家庭成员工作单位', familyPosition: '家庭成员职务', familyPhone: '家庭成员电话',
    school: '毕业院校', college: '所属学院', major: '专业名称', degree: '学历', degreeType: '培养方式', schoolType: '院校层次', gpa: 'GPA绩点', rank: '成绩排名', courses: '主修课程', eduStartDate: '入学时间', eduEndDate: '毕业时间',
    company: '公司名称', position: '担任职位', department: '所属部门', workCity: '工作城市', workStartDate: '入职时间', workEndDate: '离职时间', workDescription: '工作内容', workAchievements: '工作成果',
    projectName: '项目名称', projectRole: '项目角色', projectStartDate: '项目开始', projectEndDate: '项目结束', projectResponsibilities: '项目中职责', projectAchievements: '项目成果', techStack: '技术栈', projectDescription: '项目描述', projectUrl: '项目链接',
    skills: '专业技能', advantage: '个人优势', intro: '自我介绍',
    address: '完整地址', street: '街道地址', city: '城市', state: '省份', country: '国家', zipCode: '邮编',
    linkedin: '领英链接', github: 'GitHub', website: '个人主页', twitter: 'Twitter/X', resume: '简历附件'
  };

  let isHighlightingFields = false;
  let currentActiveProfile = null;
  let allProfilesCache = [];

  const ICONS = {
    sun: `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>`,
    moon: `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/><path d="M18.5 2.5v3M20 4h-3" stroke-width="1.5"/></svg>`,
    fill: `<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M12.8 2.2c-.3-.5-1-.3-1.1.2L8.2 12.3c-.1.3.1.6.4.6h3.8l-1.9 8.7c-.2.7.7 1.1 1.1.5l7.2-9.9c.3-.4 0-.9-.5-.9h-3.8l2.5-8.6c.1-.2 0-.5-.2-.7z"/></svg>`,
    ai: `<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M10 2.5a.6.6 0 0 1 .5.3l1.8 3.9a3.8 3.8 0 0 0 2 2l3.9 1.8a.6.6 0 0 1 0 1l-3.9 1.8a3.8 3.8 0 0 0-2 2L10.5 21a.6.6 0 0 1-1 0l-1.8-3.9a3.8 3.8 0 0 0-2-2L1.8 13.3a.6.6 0 0 1 0-1l3.9-1.8a3.8 3.8 0 0 0 2-2L9.5 2.8a.6.6 0 0 1 .5-.3zm9.5 12a.5.5 0 0 1 .4.2l.9 1.9a1.9 1.9 0 0 0 1 1l1.9.9a.5.5 0 0 1 0 .8l-1.9.9a1.9 1.9 0 0 0-1 1l-.9 1.9a.5.5 0 0 1-.8 0l-.9-1.9a1.9 1.9 0 0 0-1-1l-1.9-.9a.5.5 0 0 1 0-.8l1.9-.9a1.9 1.9 0 0 0 1-1l.9-1.9a.5.5 0 0 1 .4-.2z"/></svg>`,
    profile: `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="3.5"/><circle cx="9" cy="11" r="2.5"/><path d="M15 9h3M15 13h3M5.5 16.5c0-1.6 1.6-2.5 3.5-2.5s3.5.9 3.5 2.5"/></svg>`,
    copy: `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="12" height="13" rx="3"/><path d="M16 8V5.5A2.5 2.5 0 0 0 13.5 3h-6A2.5 2.5 0 0 0 5 5.5v9A2.5 2.5 0 0 0 7.5 17H8"/></svg>`,
    chat: `<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M12 3c5.2 0 9.5 3.6 9.5 8s-4.3 8-9.5 8c-1.1 0-2.2-.2-3.2-.5L4 20.5a.6.6 0 0 1-.8-.8l1.3-3.6C3.4 14.8 2.5 13 2.5 11c0-4.4 4.3-8 9.5-8z"/></svg>`,
    scan: `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8V5.5A2.5 2.5 0 0 1 6.5 3H9M15 3h2.5A2.5 2.5 0 0 1 20 5.5V8M20 16v2.5a2.5 2.5 0 0 1-2.5 2.5H15M9 21H6.5A2.5 2.5 0 0 1 4 18.5V16"/><circle cx="12" cy="12" r="3.2"/></svg>`,
    log: `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="3.5"/><path d="M7 9h.01M11 9h6M7 13h.01M11 13h6M7 17h.01M11 17h6"/></svg>`,
    minus: `<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
    close: `<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
    spinner: `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor"/><path d="M12 22a10 10 0 0 1-10-10" opacity="0.25" stroke="currentColor"/></svg>`
  };

  function preferredTheme() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }

  function applyFloatTheme(theme) {
    const mode = theme === 'light' ? 'light' : 'dark';
    ['job-autofill-dock', 'job-autofill-mini-ball', 'job-autofill-toolbar', 'job-autofill-profile-menu', 'job-autofill-copy-panel', 'job-autofill-ai-panel', 'job-autofill-log-panel'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.setAttribute('data-theme', mode);
    });
    const themeIcon = document.getElementById('job-autofill-theme-icon');
    if (themeIcon) {
      themeIcon.innerHTML = mode === 'light' ? ICONS.sun : ICONS.moon;
    }
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function showNotification(message, type = 'success') {
    const oldNotif = document.getElementById('job-autofill-notification');
    if (oldNotif) oldNotif.remove();

    const notification = document.createElement('div');
    notification.id = 'job-autofill-notification';
    notification.className = type;
    notification.textContent = message;
    document.body.appendChild(notification);

    setTimeout(() => {
      notification.classList.add('fade-out');
      setTimeout(() => notification.remove(), 300);
    }, 2800);
  }

  // 1. 表单字段智能探测与高亮
  function toggleFieldHighlights() {
    const badges = document.querySelectorAll('.job-autofill-field-badge');
    const highlighted = document.querySelectorAll('.job-autofill-field-highlight');

    if (isHighlightingFields) {
      badges.forEach(b => b.remove());
      highlighted.forEach(el => el.classList.remove('job-autofill-field-highlight'));
      isHighlightingFields = false;
      const btn = document.getElementById('job-autofill-btn-scan');
      if (btn) btn.classList.remove('active');
      showNotification('已关闭字段高亮探测', 'info');
      return;
    }

    const inputs = document.querySelectorAll(
      'input[type="text"], input[type="email"], input[type="tel"], ' +
      'input[type="number"], input[type="date"], input:not([type]), ' +
      'textarea, select'
    );

    let matchCount = 0;
    inputs.forEach((input) => {
      if (input.disabled || input.readOnly || input.offsetParent === null) return;
      if (isIgnoredInput(input)) return;
      const fieldType = matchFieldType(input);
      if (!fieldType) return;

      matchCount++;
      input.classList.add('job-autofill-field-highlight');

      const labelText = FIELD_LABELS[fieldType] || fieldType;
      const badge = document.createElement('div');
      badge.className = 'job-autofill-field-badge';
      badge.textContent = `🎯 ${labelText}`;

      const rect = input.getBoundingClientRect();
      badge.style.top = `${rect.top + window.scrollY - 18}px`;
      badge.style.left = `${Math.max(6, rect.left + window.scrollX + 4)}px`;
      document.body.appendChild(badge);
    });

    isHighlightingFields = true;
    const btn = document.getElementById('job-autofill-btn-scan');
    if (btn) btn.classList.add('active');

    if (matchCount > 0) {
      showNotification(`🎯 已成功识别并标记 ${matchCount} 个网申表单项`, 'success');
    } else {
      const chatInput = findChatInputElement();
      if (chatInput) {
        showNotification('🎯 检测到 HR 沟通聊天框，可直接点击「⚡ 填充」填入打招呼语', 'info');
      } else {
        showNotification('当前页面未检测到网申表单或 HR 沟通框（已忽略页面搜索框）', 'warning');
      }
    }
  }

  // 2. 自由拖动实现 (120Hz/60Hz 零延迟极速跟手，带吸附与跨页记忆)
  function initDockDragging(dock, miniBall, toolbar) {
    let isDragging = false;
    let startX = 0, startY = 0;
    let startLeft = 0, startTop = 0;
    let dockW = 0, dockH = 0;
    let winW = 0, winH = 0;
    let hasMoved = false;
    let justDragged = false;
    let rafId = null;
    let currentX = 0, currentY = 0;

    // 恢复位置与可见性记忆
    chrome.storage.local.get(['jobAutofillDockPos', 'jobAutofillDockCollapsed', 'jobAutofillDockHidden'], (res) => {
      if (res && res.jobAutofillDockHidden) {
        dock.style.display = 'none';
        return;
      }

      const isCollapsed = !!(res && res.jobAutofillDockCollapsed);
      if (isCollapsed) {
        toolbar.style.display = 'none';
        miniBall.style.display = 'flex';
      } else {
        toolbar.style.display = 'flex';
        miniBall.style.display = 'none';
      }

      const pos = res && res.jobAutofillDockPos;
      if (pos && typeof pos.left === 'number' && typeof pos.top === 'number') {
        const winW = window.innerWidth || document.documentElement.clientWidth || 1024;
        const winH = window.innerHeight || document.documentElement.clientHeight || 768;
        const w = isCollapsed ? 42 : (toolbar.offsetWidth || 550);
        const h = isCollapsed ? 42 : (toolbar.offsetHeight || 38);
        const maxL = Math.max(8, winW - w - 8);
        const maxT = Math.max(8, winH - h - 8);
        const l = Math.min(Math.max(8, pos.left), maxL);
        const t = Math.min(Math.max(8, pos.top), maxT);
        dock.style.left = `${l}px`;
        dock.style.top = `${t}px`;
        dock.style.right = 'auto';
        dock.style.bottom = 'auto';
      }
    });

    function applyPosition() {
      const dx = currentX - startX;
      const dy = currentY - startY;
      const clampedL = Math.max(8, Math.min(winW - dockW - 8, startLeft + dx));
      const clampedT = Math.max(8, Math.min(winH - dockH - 8, startTop + dy));
      dock.style.left = `${clampedL}px`;
      dock.style.top = `${clampedT}px`;
      dock.style.right = 'auto';
      dock.style.bottom = 'auto';
      rafId = null;
    }

    function onPointerDown(e) {
      if (e.button && e.button !== 0) return;
      if (e.target.closest('button') || e.target.closest('.job-autofill-tool-btn') || e.target.closest('#job-autofill-profile-menu')) {
        return;
      }

      const rect = dock.getBoundingClientRect();
      startX = e.clientX;
      startY = e.clientY;
      startLeft = rect.left;
      startTop = rect.top;
      dockW = rect.width;
      dockH = rect.height;
      winW = window.innerWidth;
      winH = window.innerHeight;
      hasMoved = false;
      currentX = e.clientX;
      currentY = e.clientY;

      const targetEl = e.target;
      if (targetEl && targetEl.setPointerCapture && e.pointerId !== undefined) {
        try { targetEl.setPointerCapture(e.pointerId); } catch (_) {}
      }

      function onPointerMove(ev) {
        currentX = ev.clientX;
        currentY = ev.clientY;
        const dx = currentX - startX;
        const dy = currentY - startY;

        if (!hasMoved) {
          if (Math.hypot(dx, dy) < 3) return;
          hasMoved = true;
          isDragging = true;
          dock.classList.add('is-dragging');
        }

        if (!rafId) {
          rafId = requestAnimationFrame(applyPosition);
        }
      }

      function onPointerUp() {
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('pointercancel', onPointerUp);

        if (rafId) {
          cancelAnimationFrame(rafId);
          rafId = null;
        }

        if (targetEl && targetEl.releasePointerCapture && e.pointerId !== undefined) {
          try { targetEl.releasePointerCapture(e.pointerId); } catch (_) {}
        }

        const dragged = isDragging || hasMoved;
        dock.classList.remove('is-dragging');
        isDragging = false;
        hasMoved = false;

        if (dragged) {
          applyPosition();
          justDragged = true;
          setTimeout(() => { justDragged = false; }, 80);
          const finalRect = dock.getBoundingClientRect();
          chrome.storage.local.set({
            jobAutofillDockPos: { left: Math.round(finalRect.left), top: Math.round(finalRect.top) }
          });
        }
      }

      window.addEventListener('pointermove', onPointerMove, { passive: true });
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('pointercancel', onPointerUp);
    }

    dock.addEventListener('pointerdown', onPointerDown);
    return {
      wasDragging: () => isDragging || justDragged
    };
  }

  let copyPayloads = [];

  function joinDateRange(start, end) {
    const a = String(start || '').trim();
    const b = String(end || '').trim();
    if (a && b) return `${a} ~ ${b}`;
    return a || b;
  }

  function pushCopyRow(items, label, val) {
    const text = val == null ? '' : String(val).trim();
    if (text && text !== '~') items.push({ label, val: text });
  }

  function formatWorkBlock(work, idx) {
    const smart = smartExtractWorkParts(work);
    const lines = [
      `【实习/工作 ${idx + 1}】${work.company || ''}`,
      work.position ? `职位：${work.position}` : '',
      work.department ? `部门：${work.department}` : '',
      work.city ? `城市：${work.city}` : '',
      work.workType ? `性质：${work.workType}` : '',
      joinDateRange(work.startDate, work.endDate) ? `时间：${joinDateRange(work.startDate, work.endDate)}` : '',
      smart.description ? `职责：\n${smart.description}` : '',
      smart.achievements ? `成果：\n${smart.achievements}` : ''
    ];
    return lines.filter(Boolean).join('\n');
  }

  function formatProjectBlock(proj, idx) {
    const smart = smartExtractProjectParts(proj);
    const lines = [
      `【项目 ${idx + 1}】${proj.name || ''}`,
      smart.role || proj.role ? `角色：${smart.role || proj.role}` : '',
      joinDateRange(proj.startDate, proj.endDate) ? `时间：${joinDateRange(proj.startDate, proj.endDate)}` : '',
      smart.techStack || proj.techStack ? `技术栈：${smart.techStack || proj.techStack}` : '',
      proj.projectUrl ? `链接：${proj.projectUrl}` : '',
      smart.description ? `描述：\n${smart.description}` : '',
      smart.responsibilities ? `职责：\n${smart.responsibilities}` : '',
      smart.achievements ? `成果：\n${smart.achievements}` : ''
    ];
    return lines.filter(Boolean).join('\n');
  }

  function renderCopyRows(container, items) {
    copyPayloads = items.map((i) => i.val);
    container.innerHTML = items.map((item, idx) => `
      <div class="job-autofill-copy-chip ${item.block ? 'is-block' : ''}" data-copy-idx="${idx}">
        <div class="chip-head">
          <span class="chip-label">${escapeHtml(item.label)}</span>
          <span class="chip-icon">📋 复制</span>
        </div>
        <span class="chip-val">${escapeHtml(item.val)}</span>
      </div>
    `).join('');

    container.querySelectorAll('.job-autofill-copy-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        const idx = Number(chip.getAttribute('data-copy-idx'));
        const text = copyPayloads[idx] || '';
        const label = chip.querySelector('.chip-label')?.textContent || '内容';
        navigator.clipboard.writeText(text).then(() => {
          showNotification(`已复制 ${label}`, 'success');
        }).catch(() => {
          showNotification('复制失败，请重试', 'error');
        });
      });
    });
  }

  function renderCopyChips(profile, category = 'basic') {
    const container = document.getElementById('job-autofill-copy-list');
    if (!container || !profile) return;

    const items = [];
    const b = profile.basicInfo || {};
    const ji = profile.jobIntention || {};
    const ls = profile.languageSkills || {};

    if (category === 'basic') {
      pushCopyRow(items, '姓名', b.fullName);
      pushCopyRow(items, '手机号', b.phone);
      pushCopyRow(items, '电子邮箱', b.email);
      pushCopyRow(items, '身份证号', b.idCard);
      pushCopyRow(items, '性别', b.gender);
      pushCopyRow(items, '出生日期', b.birthDate);
      pushCopyRow(items, '政治面貌', b.politicalStatus);
      pushCopyRow(items, '民族', b.ethnicity);
      pushCopyRow(items, '籍贯', b.hometown);
      pushCopyRow(items, '现居住城市', b.currentCity || b.location || b.city);
      pushCopyRow(items, '婚姻状况', b.maritalStatus);
      pushCopyRow(items, '毕业时间', b.graduationDate);
      pushCopyRow(items, '期望城市', ji.expectedCity);
      pushCopyRow(items, '期望岗位', ji.expectedPosition);
      pushCopyRow(items, '期望薪资', ji.expectedSalary);
      pushCopyRow(items, '到岗时间', ji.availableDate);
      pushCopyRow(items, '内推码', ji.referralCode);
      pushCopyRow(items, '招聘渠道', ji.recruitSource);
      pushCopyRow(items, '出差意愿', ji.willingToTravel);
      pushCopyRow(items, '紧急联系人', `${b.emergencyContact || ''} ${b.emergencyRelation ? '(' + b.emergencyRelation + ')' : ''} ${b.emergencyPhone || ''}`.trim());
      (profile.familyMembers || []).forEach((member, i) => {
        if (!member || !(member.name || member.relation)) return;
        const prefix = `家属${i + 1} · `;
        pushCopyRow(items, `${prefix}姓名`, member.name);
        pushCopyRow(items, `${prefix}关系`, member.relation);
        pushCopyRow(items, `${prefix}单位`, member.employer);
        pushCopyRow(items, `${prefix}职务`, member.position);
        pushCopyRow(items, `${prefix}电话`, member.phone);
      });
    } else if (category === 'edu') {
      (profile.education || []).forEach((edu, i) => {
        if (!edu || !(edu.school || edu.major)) return;
        const prefix = (profile.education.length > 1) ? `教育${i + 1} · ` : '';
        pushCopyRow(items, `${prefix}院校`, edu.school);
        pushCopyRow(items, `${prefix}学院`, edu.college);
        pushCopyRow(items, `${prefix}专业`, edu.major);
        pushCopyRow(items, `${prefix}学历`, edu.degree);
        pushCopyRow(items, `${prefix}培养方式`, edu.degreeType);
        pushCopyRow(items, `${prefix}院校层次`, edu.schoolType);
        pushCopyRow(items, `${prefix}起止`, joinDateRange(edu.startDate, edu.endDate));
        pushCopyRow(items, `${prefix}GPA`, edu.gpa);
        pushCopyRow(items, `${prefix}排名`, edu.rank);
        pushCopyRow(items, `${prefix}主修课程`, edu.courses);
      });
      pushCopyRow(items, '英语四级', ls.cet4);
      pushCopyRow(items, '英语六级', ls.cet6);
      pushCopyRow(items, '雅思', ls.ielts);
      pushCopyRow(items, '托福', ls.toefl);
      pushCopyRow(items, '其他外语', ls.otherLanguages);
      pushCopyRow(items, '荣誉奖项', (profile.awards || []).filter((a) => a && a.name).map((a) => `${a.date || ''} ${a.name} ${a.level || ''}`.trim()).join('\n'));
      (profile.certificates || []).map((item) => typeof item === 'string' ? { name: item } : item)
        .filter((item) => item && item.name)
        .forEach((certificate, i) => {
          const prefix = `证书${i + 1} · `;
          pushCopyRow(items, `${prefix}名称`, certificate.name);
          pushCopyRow(items, `${prefix}编号`, certificate.code);
          pushCopyRow(items, `${prefix}机构`, certificate.issuer);
          pushCopyRow(items, `${prefix}日期`, certificate.date);
          pushCopyRow(items, `${prefix}有效期`, certificate.expiryDate);
        });
    } else if (category === 'exp') {
      (profile.workExperience || []).forEach((work, i) => {
        if (!work || !(work.company || work.position || work.description)) return;
        const prefix = `实习${i + 1} · `;
        items.push({ label: `${prefix}整段`, val: formatWorkBlock(work, i), block: true });
        pushCopyRow(items, `${prefix}公司`, work.company);
        pushCopyRow(items, `${prefix}职位`, work.position);
        pushCopyRow(items, `${prefix}部门`, work.department);
        pushCopyRow(items, `${prefix}城市`, work.city);
        pushCopyRow(items, `${prefix}起止`, joinDateRange(work.startDate, work.endDate));
        pushCopyRow(items, `${prefix}职责`, smartExtractWorkParts(work).description || work.description);
        pushCopyRow(items, `${prefix}成果`, smartExtractWorkParts(work).achievements || work.achievements);
      });
      (profile.projects || []).forEach((proj, i) => {
        if (!proj || !(proj.name || proj.description || proj.responsibilities)) return;
        const smart = smartExtractProjectParts(proj);
        const prefix = `项目${i + 1} · `;
        items.push({ label: `${prefix}整段`, val: formatProjectBlock(proj, i), block: true });
        pushCopyRow(items, `${prefix}名称`, proj.name);
        pushCopyRow(items, `${prefix}角色`, smart.role || proj.role);
        pushCopyRow(items, `${prefix}起止`, joinDateRange(proj.startDate, proj.endDate));
        pushCopyRow(items, `${prefix}技术栈`, smart.techStack || proj.techStack);
        pushCopyRow(items, `${prefix}描述`, smart.description || proj.description);
        pushCopyRow(items, `${prefix}职责`, smart.responsibilities || proj.responsibilities);
        pushCopyRow(items, `${prefix}成果`, smart.achievements || proj.achievements);
        pushCopyRow(items, `${prefix}链接`, proj.projectUrl);
      });
    } else if (category === 'intro') {
      const skillText = Array.isArray(profile.skills) ? profile.skills.join('、') : (profile.skills?.skills || '');
      pushCopyRow(items, '自我介绍', profile.introTemplates?.default || profile.skills?.intro);
      pushCopyRow(items, '打招呼语', profile.hrGreeting);
      pushCopyRow(items, '技能清单', skillText);
      pushCopyRow(items, 'GitHub', b.github);
      pushCopyRow(items, '个人网站', b.website);
      pushCopyRow(items, 'LinkedIn', b.linkedin);
    }

    if (!items.length) {
      copyPayloads = [];
      container.innerHTML = '<div style="text-align:center;padding:24px 10px;opacity:0.6;font-size:12px;">当前分类暂未填写数据，可在设置中补充。</div>';
      return;
    }
    renderCopyRows(container, items);
  }

  function initPanelDragging(panel, handleSelector = '.job-autofill-panel-head, .job-autofill-log-head') {
    let isDragging = false;
    let startX = 0, startY = 0;
    let startLeft = 0, startTop = 0;
    let panelW = 0, panelH = 0;
    let winW = 0, winH = 0;
    let hasMoved = false;
    let rafId = null;
    let currentX = 0, currentY = 0;

    const handle = panel.querySelector(handleSelector) || panel;

    function applyPosition() {
      const dx = currentX - startX;
      const dy = currentY - startY;
      const clampedL = Math.max(8, Math.min(winW - panelW - 8, startLeft + dx));
      const clampedT = Math.max(8, Math.min(winH - panelH - 8, startTop + dy));
      panel.style.left = `${clampedL}px`;
      panel.style.top = `${clampedT}px`;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
      rafId = null;
    }

    function onPointerDown(e) {
      if (e.button && e.button !== 0) return;
      if (e.target.closest('button') || e.target.closest('input') || e.target.closest('textarea')) return;

      const rect = panel.getBoundingClientRect();
      startX = e.clientX;
      startY = e.clientY;
      startLeft = rect.left;
      startTop = rect.top;
      panelW = rect.width;
      panelH = rect.height;
      winW = window.innerWidth;
      winH = window.innerHeight;
      hasMoved = false;
      currentX = e.clientX;
      currentY = e.clientY;

      if (handle.setPointerCapture && e.pointerId !== undefined) {
        try { handle.setPointerCapture(e.pointerId); } catch (_) {}
      }

      function onPointerMove(ev) {
        currentX = ev.clientX;
        currentY = ev.clientY;
        const dx = currentX - startX;
        const dy = currentY - startY;

        if (!hasMoved) {
          if (Math.hypot(dx, dy) < 3) return;
          hasMoved = true;
          isDragging = true;
          panel.classList.add('is-dragging');
        }

        if (!rafId) {
          rafId = requestAnimationFrame(applyPosition);
        }
      }

      function onPointerUp() {
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('pointercancel', onPointerUp);

        if (rafId) {
          cancelAnimationFrame(rafId);
          rafId = null;
        }

        if (handle.releasePointerCapture && e.pointerId !== undefined) {
          try { handle.releasePointerCapture(e.pointerId); } catch (_) {}
        }

        if (isDragging || hasMoved) {
          applyPosition();
        }

        panel.classList.remove('is-dragging');
        isDragging = false;
        hasMoved = false;
      }

      window.addEventListener('pointermove', onPointerMove, { passive: true });
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('pointercancel', onPointerUp);
    }

    handle.addEventListener('pointerdown', onPointerDown);
  }

  function createCopyDrawer(theme) {
    if (document.getElementById('job-autofill-copy-panel')) return;
    const panel = document.createElement('div');
    panel.id = 'job-autofill-copy-panel';
    panel.setAttribute('data-theme', theme);
    panel.innerHTML = `
      <div class="job-autofill-panel-head" title="按住标题栏可自由拖动位置">
        <div style="display:flex;align-items:center;gap:6px;">
          <span style="font-size:13px;display:inline-flex;align-items:center;">📋</span>
          <span>快捷资料小抄 (点击即复制)</span>
        </div>
        <button type="button" id="job-autofill-copy-close" class="job-autofill-tool-btn" style="height:26px;padding:0 8px;">✕</button>
      </div>
      <div class="job-autofill-panel-tabs">
        <button type="button" class="job-autofill-tab-btn active" data-tab="basic">👤 基本信息</button>
        <button type="button" class="job-autofill-tab-btn" data-tab="edu">🎓 教育成绩</button>
        <button type="button" class="job-autofill-tab-btn" data-tab="exp">💼 实习项目</button>
        <button type="button" class="job-autofill-tab-btn" data-tab="intro">💡 自述链接</button>
      </div>
      <div id="job-autofill-copy-list" class="job-autofill-copy-content"></div>
    `;
    document.body.appendChild(panel);
    initPanelDragging(panel);

    panel.querySelector('#job-autofill-copy-close').addEventListener('click', () => {
      panel.style.display = 'none';
      document.getElementById('job-autofill-btn-copy')?.classList.remove('active');
    });

    panel.querySelectorAll('.job-autofill-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        panel.querySelectorAll('.job-autofill-tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderCopyChips(currentActiveProfile, btn.getAttribute('data-tab'));
      });
    });
  }

  // 4. AI 智能问答与打招呼语抽屉
  function createAiCopilotDrawer(theme) {
    if (document.getElementById('job-autofill-ai-panel')) return;
    const panel = document.createElement('div');
    panel.id = 'job-autofill-ai-panel';
    panel.setAttribute('data-theme', theme);
    panel.innerHTML = `
      <div class="job-autofill-panel-head" title="按住标题栏可自由拖动位置">
        <div style="display:flex;align-items:center;gap:6px;">
          <span style="font-size:13px;display:inline-flex;align-items:center;">🤖</span>
          <span>AI 求职 Copilot</span>
        </div>
        <button type="button" id="job-autofill-ai-close" class="job-autofill-tool-btn" style="height:26px;padding:0 8px;">✕</button>
      </div>
      <div class="job-autofill-ai-body">
        <div style="font-size:11px;opacity:0.75;display:flex;align-items:center;gap:4px;">
          <span>🎯 检测目标岗位：</span>
          <strong id="job-autofill-detected-pos" style="color:#38bdf8;">...</strong>
        </div>
        <div class="job-autofill-ai-presets">
          <button type="button" class="job-autofill-preset-btn" data-type="greeting">✉️ 100字 HR 打招呼语</button>
          <button type="button" class="job-autofill-preset-btn" data-type="why_us">💡 为什么申请该岗位</button>
          <button type="button" class="job-autofill-preset-btn" data-type="advantage">🌟 提炼核心岗位优势</button>
        </div>
        <textarea id="job-autofill-ai-prompt" class="job-autofill-ai-input" placeholder="可粘贴网申开放题（如：请谈谈你最有成就感的一件事）让 AI 结合简历生成..."></textarea>
        <button type="button" id="job-autofill-ai-submit" class="job-autofill-tool-btn job-autofill-btn-fill" style="justify-content:center;height:36px;border-radius:10px;">
          <span>✨ 结合简历智能生成</span>
        </button>
        <div id="job-autofill-ai-result-box" class="job-autofill-ai-output">
          <div id="job-autofill-ai-text"></div>
          <button type="button" id="job-autofill-ai-copy-btn" class="job-autofill-tool-btn" style="align-self:flex-end;height:26px;margin-top:4px;">
            <span>📋 一键复制结果</span>
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(panel);
    initPanelDragging(panel);

    const posEl = panel.querySelector('#job-autofill-detected-pos');
    const detectedPos = detectPositionName(currentActiveProfile, { allowProfileFallback: false }) || '网申职位';
    if (posEl) posEl.textContent = detectedPos;

    panel.querySelector('#job-autofill-ai-close').addEventListener('click', () => {
      panel.style.display = 'none';
      document.getElementById('job-autofill-btn-ai')?.classList.remove('active');
    });

    panel.querySelectorAll('.job-autofill-preset-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const type = btn.getAttribute('data-type');
        const input = panel.querySelector('#job-autofill-ai-prompt');
        const pos = detectPositionName(currentActiveProfile) || '应聘岗位';
        if (type === 'greeting') {
          input.value = `请为我生成一段 100~150 字得体、自信、高情商的应聘打招呼语，应聘岗位为「${pos}」，结合我的专业和实习经历。`;
        } else if (type === 'why_us') {
          input.value = `请结合我的专业背景和项目经历，回答网申问题：「你为什么选择申请我们公司的「${pos}」岗位？你的个人优势是什么？」输出 200 字左右。`;
        } else if (type === 'advantage') {
          input.value = `请针对「${pos}」岗位要求，结合我的简历，提炼出 3 条最核心、最具说服力的个人求职优势，条理清晰。`;
        }
        panel.querySelector('#job-autofill-ai-submit').click();
      });
    });

    const submitBtn = panel.querySelector('#job-autofill-ai-submit');
    const resultBox = panel.querySelector('#job-autofill-ai-result-box');
    const resultText = panel.querySelector('#job-autofill-ai-text');

    submitBtn.addEventListener('click', () => {
      const prompt = panel.querySelector('#job-autofill-ai-prompt').value.trim();
      if (!prompt) {
        showNotification('请先输入或选择提示词', 'warning');
        return;
      }

      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span class="tool-icon">⏳</span><span>AI 正在深度思考生成中...</span>';
      resultBox.style.display = 'none';

      const resumeBrief = JSON.stringify(slimResumeContext(currentActiveProfile || {}));
      const systemPrompt = `你是秋招求职顾问。根据简历回答，只输出正文，不要前缀。\n简历：${resumeBrief}`;

      chrome.runtime.sendMessage({
        action: 'aiGenerate',
        prompt,
        systemPrompt,
        maxTokens: 500
      }, (res) => {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<span>✨ 结合简历智能生成</span>';

        if (res && res.success && res.text) {
          resultBox.style.display = 'flex';
          resultText.textContent = res.text.trim();
          showNotification('AI 回答已生成', 'success');
        } else {
          showNotification(res?.error || res?.message || '生成失败，请检查 AI API 配置', 'error');
        }
      });
    });

    panel.querySelector('#job-autofill-ai-copy-btn').addEventListener('click', () => {
      const text = resultText.textContent || '';
      if (!text) return;
      navigator.clipboard.writeText(text).then(() => {
        showNotification('✅ AI 回答已复制到剪贴板', 'success');
      });
    });
  }

  // 5. 运行日志面板
  function renderPageLogs(logs) {
    const list = document.getElementById('job-autofill-log-list');
    const empty = document.getElementById('job-autofill-log-empty');
    if (!list) return;
    const rows = (logs || []).slice().reverse().slice(0, 200);
    if (!rows.length) {
      list.innerHTML = '';
      if (empty) empty.style.display = 'block';
      return;
    }
    if (empty) empty.style.display = 'none';
    list.innerHTML = rows.map((item) => {
      const time = String(item.time || '').replace('T', ' ').replace('Z', '').slice(11, 19);
      const detail = item.detail
        ? `<pre class="job-autofill-log-detail">${escapeHtml(item.detail)}</pre>`
        : '';
      return `<article class="job-autofill-log-item is-${escapeHtml(item.level || 'info')}">
        <div class="job-autofill-log-meta">
          <span>${escapeHtml(time)}</span>
          <span class="job-autofill-log-level">${escapeHtml(item.level || 'info')}</span>
        </div>
        <div class="job-autofill-log-msg">${escapeHtml(item.message || '')}</div>
        ${detail}
      </article>`;
    }).join('');
  }

  function toggleLogPanel(forceOpen) {
    const panel = document.getElementById('job-autofill-log-panel');
    if (!panel) return;
    const open = forceOpen === undefined ? panel.getAttribute('data-open') !== 'true' : !!forceOpen;
    panel.setAttribute('data-open', open ? 'true' : 'false');
    const logBtn = document.getElementById('job-autofill-btn-log');
    if (logBtn) {
      if (open) logBtn.classList.add('active');
      else logBtn.classList.remove('active');
    }
    if (open) {
      panel.classList.remove('job-autofill-panel-in');
      void panel.offsetWidth;
      panel.classList.add('job-autofill-panel-in');
      panel.addEventListener('animationend', () => {
        panel.classList.remove('job-autofill-panel-in');
      }, { once: true });

      chrome.storage.local.get('jobAutofillLogs', (res) => {
        renderPageLogs(res && res.jobAutofillLogs);
      });
    } else {
      panel.classList.remove('job-autofill-panel-in');
    }
  }

  function createLogPanel(theme) {
    if (document.getElementById('job-autofill-log-panel')) return;
    const panel = document.createElement('div');
    panel.id = 'job-autofill-log-panel';
    panel.setAttribute('data-theme', theme);
    panel.setAttribute('data-open', 'false');
    panel.innerHTML = `
      <div class="job-autofill-log-head" title="按住标题栏可自由拖动位置">
        <span>📜 运行日志</span>
        <div class="job-autofill-log-actions">
          <button type="button" id="job-autofill-log-clear">清空</button>
          <button type="button" id="job-autofill-log-close">收起</button>
        </div>
      </div>
      <div id="job-autofill-log-empty" class="job-autofill-log-empty">还没有记录。填充、解析、模型调用都会出现在这里。</div>
      <div id="job-autofill-log-list" class="job-autofill-log-list"></div>
    `;
    document.body.appendChild(panel);
    initPanelDragging(panel, '.job-autofill-log-head');
    panel.querySelector('#job-autofill-log-close').addEventListener('click', () => toggleLogPanel(false));
    panel.querySelector('#job-autofill-log-clear').addEventListener('click', () => {
      if (typeof appLog !== 'undefined') appLog.clear().then(() => renderPageLogs([]));
      else chrome.storage.local.set({ jobAutofillLogs: [] }, () => renderPageLogs([]));
    });
  }

  // 6. 创建升级版可拖动全局悬浮 Dock
  function createFloatingButton() {
    if (document.getElementById('job-autofill-dock')) return;
    if (!document.body) {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', createFloatingButton, { once: true });
      }
      return;
    }
    const theme = preferredTheme();

    const dock = document.createElement('div');
    dock.id = 'job-autofill-dock';
    dock.setAttribute('data-theme', theme);

    // 折叠迷你圆球
    const miniBall = document.createElement('div');
    miniBall.id = 'job-autofill-mini-ball';
    miniBall.setAttribute('data-theme', theme);
    miniBall.title = 'Capybara 网申助手 (点击展开)';
    miniBall.innerHTML = `<span class="mini-ball-icon">🦫</span><span class="mini-dot"></span>`;

    // 展开工具条
    const toolbar = document.createElement('div');
    toolbar.id = 'job-autofill-toolbar';
    toolbar.setAttribute('data-theme', theme);
    toolbar.innerHTML = `
      <div class="job-autofill-drag-handle" title="按住可拖动悬浮窗">
        <span class="job-autofill-brand" title="点击收起 (按住可拖动)">
          <span class="brand-capy-icon">🦫</span>
          <span class="brand-text">助手</span>
        </span>
        <svg class="job-autofill-drag-dots" viewBox="0 0 24 24" width="8" height="12" fill="currentColor">
          <circle cx="6" cy="4" r="1.8"/>
          <circle cx="6" cy="12" r="1.8"/>
          <circle cx="6" cy="20" r="1.8"/>
          <circle cx="16" cy="4" r="1.8"/>
          <circle cx="16" cy="12" r="1.8"/>
          <circle cx="16" cy="20" r="1.8"/>
        </svg>
      </div>

      <div class="job-autofill-divider"></div>

      <button type="button" id="job-autofill-btn-fill" class="job-autofill-tool-btn job-autofill-btn-fill" title="一键识别并填充当前网页表单（毫秒级快填）">
        <span class="tool-icon btn-spin-icon">${ICONS.fill}</span>
        <span class="tool-text">填充</span>
      </button>

      <button type="button" id="job-autofill-btn-ai-step" class="job-autofill-tool-btn job-autofill-btn-ai-fill" title="AI 逐步深度解析与智能填表 (自动攻克开放性主观问答题与复杂字段)">
        <span class="tool-icon">${ICONS.ai}</span>
        <span class="tool-text">AI助填</span>
      </button>

      <div class="job-autofill-divider"></div>

      <button type="button" id="job-autofill-btn-profile" class="job-autofill-tool-btn" title="快速切换当前简历配置">
        <span class="tool-icon">${ICONS.profile}</span>
        <span id="job-autofill-active-profile-name" class="job-autofill-profile-pill tool-text">默认资料</span>
      </button>

      <button type="button" id="job-autofill-btn-copy" class="job-autofill-tool-btn" title="打开快捷资料小抄抽屉 (一键复制)">
        <span class="tool-icon">${ICONS.copy}</span>
        <span class="tool-text">小抄</span>
      </button>

      <button type="button" id="job-autofill-btn-ai" class="job-autofill-tool-btn" title="AI 求职 Copilot / HR 招呼语与对话生成">
        <span class="tool-icon">${ICONS.chat}</span>
        <span class="tool-text">招呼</span>
      </button>

      <div class="job-autofill-divider"></div>

      <button type="button" id="job-autofill-btn-scan" class="job-autofill-tool-btn job-autofill-btn-icon" title="高亮标记页面上已识别的表单项">
        <span class="tool-icon">${ICONS.scan}</span>
      </button>

      <button type="button" id="job-autofill-btn-log" class="job-autofill-tool-btn job-autofill-btn-icon" title="查看运行日志">
        <span class="tool-icon">${ICONS.log}</span>
      </button>

      <button type="button" id="job-autofill-btn-theme" class="job-autofill-tool-btn job-autofill-btn-icon" title="切换深色/浅色模式">
        <span id="job-autofill-theme-icon" class="tool-icon">${theme === 'light' ? ICONS.sun : ICONS.moon}</span>
      </button>

      <button type="button" id="job-autofill-btn-collapse" class="job-autofill-tool-btn job-autofill-btn-icon" title="收起为迷你小圆点">
        <span class="tool-icon">${ICONS.minus}</span>
      </button>

      <button type="button" id="job-autofill-btn-close" class="job-autofill-tool-btn job-autofill-btn-icon job-autofill-btn-close" title="完全关闭悬浮窗 (可在插件弹窗中随时恢复)">
        <span class="tool-icon">${ICONS.close}</span>
      </button>

      <div id="job-autofill-profile-menu" data-theme="${theme}"></div>
    `;

    dock.appendChild(miniBall);
    dock.appendChild(toolbar);
    document.body.appendChild(dock);

    // 初始化功能抽屉
    createCopyDrawer(theme);
    createAiCopilotDrawer(theme);
    createLogPanel(theme);

    // 绑定拖拽
    const dragCtl = initDockDragging(dock, miniBall, toolbar);

    const collapseDock = () => {
      toolbar.style.display = 'none';
      miniBall.style.display = 'flex';
      chrome.storage.local.set({ jobAutofillDockCollapsed: true });
    };

    const expandDock = () => {
      miniBall.style.display = 'none';
      toolbar.style.display = 'flex';
      // 检查展开后是否溢出屏幕右/下边缘，自动修正位置
      const rect = dock.getBoundingClientRect();
      const dockW = toolbar.offsetWidth || 650;
      const dockH = toolbar.offsetHeight || 44;
      let left = rect.left;
      let top = rect.top;
      let adjusted = false;
      if (left + dockW > window.innerWidth - 8) {
        left = Math.max(8, window.innerWidth - dockW - 8);
        adjusted = true;
      }
      if (top + dockH > window.innerHeight - 8) {
        top = Math.max(8, window.innerHeight - dockH - 8);
        adjusted = true;
      }
      if (adjusted) {
        dock.style.left = `${left}px`;
        dock.style.top = `${top}px`;
        dock.style.right = 'auto';
        dock.style.bottom = 'auto';
        chrome.storage.local.set({
          jobAutofillDockPos: { left: Math.round(left), top: Math.round(top) }
        });
      }
      chrome.storage.local.set({ jobAutofillDockCollapsed: false, jobAutofillDockHidden: false });
    };

    // 点击迷你圆球展开
    miniBall.addEventListener('click', () => {
      if (dragCtl.wasDragging()) return;
      expandDock();
    });

    // 迷你圆球右键快速关闭
    miniBall.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      dock.style.display = 'none';
      chrome.storage.local.set({ jobAutofillDockHidden: true });
      showNotification('💡 已关闭悬浮窗。在浏览器插件弹窗中可随时重新开启！', 'info');
    });

    // 收起为迷你圆球 (右侧缩小按钮)
    toolbar.querySelector('#job-autofill-btn-collapse').addEventListener('click', (e) => {
      e.stopPropagation();
      collapseDock();
    });

    // 点击左侧卡皮巴拉/助手品牌收起
    const brandEl = toolbar.querySelector('.job-autofill-brand');
    if (brandEl) {
      brandEl.addEventListener('click', (e) => {
        if (dragCtl.wasDragging()) return;
        e.stopPropagation();
        collapseDock();
      });
    }

    // 完全关闭悬浮窗
    toolbar.querySelector('#job-autofill-btn-close').addEventListener('click', (e) => {
      e.stopPropagation();
      dock.style.display = 'none';
      chrome.storage.local.set({ jobAutofillDockHidden: true });
      showNotification('💡 已关闭悬浮窗。可在浏览器右上角插件弹窗中随时重新开启！', 'info');
    });

    // 1. 一键毫秒填充事件
    const fillBtn = toolbar.querySelector('#job-autofill-btn-fill');
    fillBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (dragCtl.wasDragging()) return;
      fillBtn.classList.add('is-busy');
      const iconEl = fillBtn.querySelector('.tool-icon');
      if (iconEl) iconEl.innerHTML = ICONS.spinner;

      runtimeSend({ action: 'getActiveProfile' }, 8000).then((response) => {
        if (response && response.success && response.profile) {
          currentActiveProfile = response.profile;
          return fillForm(response.profile).then((res) => {
            if (res && res.isChat) {
              showNotification('✅ 已将 HR 打招呼语自动填入沟通框，可核对发送！', 'success');
            } else if (res?.manualFields?.length) {
              showNotification(`已填充 ${res.filledCount} 个字段；${res.manualFields.length} 项需手动确认，请查看字段旁的提示`, 'warning');
            } else if (res && res.filledCount > 0) {
              showNotification(`✅ 已成功自动填充 ${res.filledCount} 个网申字段！`, 'success');
            } else if (res?.isForm) {
              showNotification('本轮没有新增填充；已填内容保持不变，缺少的资料请手动补充', 'info');
            } else {
              showNotification('💡 当前处于职位浏览/搜索页，未检测到网申表单。请点击职位「立即沟通」打开聊天框，或进入招聘详情网申页后再点击填充。', 'info');
            }
          });
        }
        showNotification(response?.error === 'timeout' ? '后台无响应，请再点一次填充' : '请先在插件配置资料', 'warning');
      }).catch((error) => {
        showNotification(error.message || '填充失败', 'error');
      }).finally(() => {
        fillBtn.classList.remove('is-busy');
        const iconEl = fillBtn.querySelector('.tool-icon');
        if (iconEl) iconEl.innerHTML = ICONS.fill;
      });
    });

    // 1.2 AI 逐步深度填充事件
    const aiStepBtn = toolbar.querySelector('#job-autofill-btn-ai-step');
    if (aiStepBtn) {
      aiStepBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (dragCtl.wasDragging()) return;
        if (aiFillRunning) {
          showNotification('AI 助填正在进行中', 'info');
          return;
        }
        aiStepBtn.classList.add('is-busy');
        aiStepBtn.innerHTML = `<span class="tool-icon btn-spin-icon">${ICONS.spinner}</span><span class="tool-text">分析中</span>`;

        runtimeSend({ action: 'getActiveProfile' }, 8000).then((response) => {
          if (response && response.success && response.profile) {
            currentActiveProfile = response.profile;
            return aiStepByStepFill(response.profile);
          }
          showNotification(response?.error === 'timeout' ? '后台无响应，请再点一次 AI 助填' : '请先在插件配置资料', 'warning');
        }).catch((err) => {
          console.error('[Capybara助手] AI助填执行异常:', err);
          showNotification(err.message || 'AI 助填执行失败', 'error');
        }).finally(() => {
          aiStepBtn.classList.remove('is-busy');
          aiStepBtn.innerHTML = `<span class="tool-icon">${ICONS.ai}</span><span class="tool-text">AI助填</span>`;
        });
      });
    }

    // 2. 简历快速切换弹层
    const profileBtn = toolbar.querySelector('#job-autofill-btn-profile');
    const profileMenu = toolbar.querySelector('#job-autofill-profile-menu');
    const profileLabel = toolbar.querySelector('#job-autofill-active-profile-name');

    function refreshProfilesMenu() {
      chrome.runtime.sendMessage({ action: 'getAllProfiles' }, (res) => {
        if (res && res.success) {
          allProfilesCache = res.profiles || [];
          const actId = res.activeProfileId;
          const activeP = allProfilesCache.find(p => p.id === actId) || allProfilesCache[0];
          if (activeP) {
            currentActiveProfile = activeP;
            profileLabel.textContent = activeP.name || '默认资料';
          }

          profileMenu.innerHTML = allProfilesCache.map(p => `
            <div class="job-autofill-profile-item ${p.id === actId ? 'active' : ''}" data-id="${p.id}">
              <span>${escapeHtml(p.name)}</span>
              ${p.id === actId ? '<span>✓</span>' : ''}
            </div>
          `).join('');

          profileMenu.querySelectorAll('.job-autofill-profile-item').forEach(item => {
            item.addEventListener('click', (ev) => {
              ev.stopPropagation();
              const pid = item.getAttribute('data-id');
              chrome.runtime.sendMessage({ action: 'setActiveProfile', profileId: pid }, (switchRes) => {
                if (switchRes && switchRes.success) {
                  profileMenu.style.display = 'none';
                  refreshProfilesMenu();
                  showNotification(`已切换为「${item.querySelector('span').textContent}」资料`, 'success');
                }
              });
            });
          });
        }
      });
    }

    function positionProfileMenu() {
      const btnRect = profileBtn.getBoundingClientRect();
      const toolbarRect = toolbar.getBoundingClientRect();
      const leftOffset = btnRect.left - toolbarRect.left;
      profileMenu.style.left = `${Math.max(0, leftOffset)}px`;
      profileMenu.style.right = 'auto';

      const spaceBelow = window.innerHeight - btnRect.bottom;
      if (spaceBelow < 200 && btnRect.top > 200) {
        profileMenu.style.bottom = 'calc(100% + 6px)';
        profileMenu.style.top = 'auto';
      } else {
        profileMenu.style.top = 'calc(100% + 6px)';
        profileMenu.style.bottom = 'auto';
      }
    }

    profileBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (dragCtl.wasDragging()) return;
      const isOpen = profileMenu.style.display === 'flex';
      if (isOpen) {
        profileMenu.style.display = 'none';
      } else {
        positionProfileMenu();
        profileMenu.style.display = 'flex';
        refreshProfilesMenu();
      }
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('#job-autofill-btn-profile') && !e.target.closest('#job-autofill-profile-menu')) {
        profileMenu.style.display = 'none';
      }
    });

    function showPanelAnimated(panel) {
      panel.style.display = 'flex';
      panel.classList.remove('job-autofill-panel-in');
      void panel.offsetWidth;
      panel.classList.add('job-autofill-panel-in');
      panel.addEventListener('animationend', () => {
        panel.classList.remove('job-autofill-panel-in');
      }, { once: true });
    }

    // 3. 小抄抽屉切换
    const copyBtn = toolbar.querySelector('#job-autofill-btn-copy');
    const copyPanel = document.getElementById('job-autofill-copy-panel');
    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (dragCtl.wasDragging()) return;
      const isOpen = copyPanel.style.display === 'flex';
      if (isOpen) {
        copyPanel.style.display = 'none';
        copyPanel.classList.remove('job-autofill-panel-in');
      } else {
        showPanelAnimated(copyPanel);
      }
      copyBtn.classList.toggle('active', !isOpen);

      if (!isOpen) {
        // 关闭其他抽屉
        document.getElementById('job-autofill-ai-panel').style.display = 'none';
        document.getElementById('job-autofill-btn-ai').classList.remove('active');
        toggleLogPanel(false);

        if (!currentActiveProfile) {
          chrome.runtime.sendMessage({ action: 'getActiveProfile' }, (r) => {
            if (r?.profile) {
              currentActiveProfile = r.profile;
              renderCopyChips(currentActiveProfile, 'basic');
            }
          });
        } else {
          renderCopyChips(currentActiveProfile, 'basic');
        }
      }
    });

    // 4. AI 抽屉切换
    const aiBtn = toolbar.querySelector('#job-autofill-btn-ai');
    const aiPanel = document.getElementById('job-autofill-ai-panel');
    aiBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (dragCtl.wasDragging()) return;
      const isOpen = aiPanel.style.display === 'flex';
      if (isOpen) {
        aiPanel.style.display = 'none';
        aiPanel.classList.remove('job-autofill-panel-in');
      } else {
        showPanelAnimated(aiPanel);
      }
      aiBtn.classList.toggle('active', !isOpen);

      if (!isOpen) {
        // 关闭其他抽屉
        copyPanel.style.display = 'none';
        copyBtn.classList.remove('active');
        toggleLogPanel(false);
      }
    });

    // 5. 字段高亮探测切换
    const scanBtn = toolbar.querySelector('#job-autofill-btn-scan');
    scanBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (dragCtl.wasDragging()) return;
      toggleFieldHighlights();
    });

    // 6. 日志抽屉切换
    const logBtn = toolbar.querySelector('#job-autofill-btn-log');
    logBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (dragCtl.wasDragging()) return;
      copyPanel.style.display = 'none';
      copyBtn.classList.remove('active');
      aiPanel.style.display = 'none';
      aiBtn.classList.remove('active');
      toggleLogPanel();
    });

    // 7. 深色/浅色模式一键切换
    const themeBtn = toolbar.querySelector('#job-autofill-btn-theme');
    themeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (dragCtl.wasDragging()) return;
      const currentTheme = dock.getAttribute('data-theme') || preferredTheme();
      const nextTheme = currentTheme === 'light' ? 'dark' : 'light';
      applyFloatTheme(nextTheme);

      chrome.runtime.sendMessage({
        action: 'updateSettings',
        settings: { uiTheme: nextTheme }
      });
    });

    // 初始化数据
    refreshProfilesMenu();

    chrome.runtime.sendMessage({ action: 'getSettings' }, (response) => {
      const saved = response && response.success ? response.settings?.uiTheme : '';
      applyFloatTheme(saved || theme);
    });
  }

  // ========================================================================
  // 初始化
  // ========================================================================

  function init() {
    console.log('[Capybara助手] Content Script 已加载');

    let jobMetaRefreshTimer = null;
    const scheduleJobMetaRefresh = (delay = 500) => {
      clearTimeout(jobMetaRefreshTimer);
      jobMetaRefreshTimer = setTimeout(cacheJobMetaFromPage, delay);
    };

    cacheJobMetaFromPage();
    createFloatingButton();

    window.addEventListener('load', () => {
      cacheJobMetaFromPage();
      createFloatingButton();
    });
    window.addEventListener('pageshow', () => {
      scheduleJobMetaRefresh(300);
      createFloatingButton();
    });
    window.addEventListener('hashchange', () => {
      scheduleJobMetaRefresh(800);
      createFloatingButton();
    });
    window.addEventListener('popstate', () => scheduleJobMetaRefresh(800));

    setTimeout(cacheJobMetaFromPage, 1200);
    setTimeout(cacheJobMetaFromPage, 3000);

    // SPA 的岗位详情通常晚于 document_idle 才渲染；DOM 稳定后重新提取岗位信息。
    if (window.MutationObserver) {
      const observer = new MutationObserver((mutations) => {
        if (document.body && !document.getElementById('job-autofill-dock')) {
          createFloatingButton();
        }
        if (mutations.some((mutation) => !mutation.target.closest?.('#job-autofill-dock, #job-autofill-copy-panel, #job-autofill-ai-panel, #job-autofill-log-panel'))) {
          scheduleJobMetaRefresh();
        }
      });
      if (document.body) {
        observer.observe(document.body, { childList: true, subtree: true });
      } else {
        document.addEventListener('DOMContentLoaded', () => {
          if (document.body) observer.observe(document.body, { childList: true, subtree: true });
        });
      }
    }

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes.jobAutofillData) {
        const theme = changes.jobAutofillData.newValue?.settings?.uiTheme;
        if (theme) applyFloatTheme(theme);
      }
      if (changes.jobAutofillLogs) {
        renderPageLogs(changes.jobAutofillLogs.newValue || []);
      }
    });

    // 监听来自 popup 的消息
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === 'fillForm') {
        fillForm(request.profile).then(result => {
          sendResponse({ success: true, result });
        }).catch(err => {
          sendResponse({ success: false, error: err.message });
        });
        return true;
      }
      if (request.action === 'aiStepByStepFill') {
        aiStepByStepFill(request.profile).then(result => {
          sendResponse({ success: true, result });
        }).catch(err => {
          sendResponse({ success: false, error: err.message });
        });
        return true;
      }
      if (request.action === 'toggleDock') {
        const dock = document.getElementById('job-autofill-dock');
        const toolbar = document.getElementById('job-autofill-toolbar');
        const miniBall = document.getElementById('job-autofill-mini-ball');
        if (!dock) {
          createFloatingButton();
          sendResponse({ success: true, visible: true });
          return true;
        }
        const isHidden = dock.style.display === 'none';
        if (isHidden) {
          dock.style.display = 'flex';
          toolbar.style.display = 'flex';
          if (miniBall) miniBall.style.display = 'none';
          const rect = dock.getBoundingClientRect();
          const dockW = toolbar.offsetWidth || 650;
          if (rect.left + dockW > window.innerWidth - 8) {
            dock.style.left = `${Math.max(8, window.innerWidth - dockW - 8)}px`;
            dock.style.right = 'auto';
          }
          chrome.storage.local.set({ jobAutofillDockHidden: false, jobAutofillDockCollapsed: false });
          sendResponse({ success: true, visible: true });
        } else {
          dock.style.display = 'none';
          chrome.storage.local.set({ jobAutofillDockHidden: true });
          sendResponse({ success: true, visible: false });
        }
        return true;
      }
      if (request.action === 'showDock') {
        const dock = document.getElementById('job-autofill-dock');
        const toolbar = document.getElementById('job-autofill-toolbar');
        const miniBall = document.getElementById('job-autofill-mini-ball');
        if (!dock) {
          createFloatingButton();
        } else {
          dock.style.display = 'flex';
          toolbar.style.display = 'flex';
          if (miniBall) miniBall.style.display = 'none';
          const rect = dock.getBoundingClientRect();
          const dockW = toolbar.offsetWidth || 650;
          if (rect.left + dockW > window.innerWidth - 8) {
            dock.style.left = `${Math.max(8, window.innerWidth - dockW - 8)}px`;
            dock.style.right = 'auto';
          }
        }
        chrome.storage.local.set({ jobAutofillDockHidden: false, jobAutofillDockCollapsed: false });
        sendResponse({ success: true });
        return true;
      }
    });
  }

  // 页面加载完成后初始化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
