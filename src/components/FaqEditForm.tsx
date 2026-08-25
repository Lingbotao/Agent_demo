/**
 * FAQ 新增/编辑表单组件（完全脱离 TDesign Form）
 *
 */

import { useState } from 'react';

export interface FaqFormValues {
  question: string;
  answer: string;
  category: string;
  keywords: string;
}

interface FaqEditFormProps {
  initialValues: FaqFormValues;
  onChange: (values: FaqFormValues) => void;
}

const CATEGORY_OPTIONS = [
  { value: 'refund', label: '退款' },
  { value: 'order_inquiry', label: '订单查询' },
  { value: 'tech_support', label: '技术支持' },
  { value: 'general', label: '通用咨询' },
];

// TDesign FormItem 的视觉结构：左侧 label + 右侧 input
const labelStyle: React.CSSProperties = {
  textAlign: 'right',
  paddingRight: 12,
  lineHeight: '30px',
  color: 'var(--td-text-color-secondary)',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  height: 30,
  padding: '0 11px',
  border: '1px solid var(--td-component-border)',
  borderRadius: 3,
  background: 'var(--td-bg-color-container)',
  color: 'var(--td-text-color-primary)',
  outline: 'none',
  fontFamily: 'inherit',
  fontSize: 'inherit',
  transition: 'border-color 0.2s',
};

const textareaStyle: React.CSSProperties = {
  ...inputStyle,
  height: 'auto',
  minHeight: 120,
  padding: 8,
  resize: 'vertical',
};

const rowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '88px 1fr',
  gap: 8,
  marginBottom: 16,
  alignItems: 'start',
};

export function FaqEditForm({ initialValues, onChange }: FaqEditFormProps) {
  // 关键修复：去掉 useEffect，改为在事件回调中同步通知父组件。
  // 原 useEffect 依赖 [values.question, values.answer, ...] 是异步的，
  // 用户连续修改 + 立刻点保存时，父组件 setForm 可能还没拿到最新值。
  // 早期方案把 onChange 放在 setValues 的 updater 里，会触发
  // "Cannot update a component while rendering a different component" 警告，
  // 因为 updater 可能在 render 期间被 React 调用，从而同步触发父组件 setState。
  // 修复方案：在事件回调里基于当前闭包的 values 算出 next，先调 onChange 再 setValues，
  // onChange 在事件回调中调用是合法的（不在 render 期间），不会触发警告，
  // 同时父组件 form state 在 setForm 之前就已拿到最新值，submit 闭包读到的是新值。
  const [values, setValues] = useState<FaqFormValues>(() => initialValues);

  const update = <K extends keyof FaqFormValues>(key: K, v: FaqFormValues[K]) => {
    const next: FaqFormValues = { ...values, [key]: v };
    // 同步通知父组件（事件回调里调用 setState 是合法的）
    onChange(next);
    setValues(next);
  };

  return (
    <div>
      <div style={rowStyle}>
        <div style={labelStyle}>问题</div>
        <input
          className="t-input__inner"
          style={inputStyle}
          value={values.question}
          onChange={(e) => update('question', e.target.value)}
          placeholder="如：如何申请退款？"
          maxLength={200}
        />
      </div>

      <div style={rowStyle}>
        <div style={labelStyle}>分类</div>
        <select
          style={inputStyle}
          value={values.category}
          onChange={(e) => update('category', e.target.value)}
        >
          {CATEGORY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div style={rowStyle}>
        <div style={labelStyle}>关键词</div>
        <input
          className="t-input__inner"
          style={inputStyle}
          value={values.keywords}
          onChange={(e) => update('keywords', e.target.value)}
          placeholder="空格分隔多个关键词，便于检索（如：退款 流程 怎么退）"
        />
      </div>

      <div style={rowStyle}>
        <div style={{ ...labelStyle, lineHeight: '24px', paddingTop: 6 }}>答案</div>
        <textarea
          className="t-textarea__inner"
          style={textareaStyle}
          value={values.answer}
          onChange={(e) => update('answer', e.target.value)}
          placeholder="Markdown / 多行文本均可"
        />
      </div>
    </div>
  );
}
