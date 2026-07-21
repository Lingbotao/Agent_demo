/**
 * 满意度评分组件
 * 在对话结束后展示，让用户对服务进行评分
 */

import { useState } from 'react';
import { Rate, Textarea, Button, MessagePlugin } from 'tdesign-react';

interface SatisfactionRatingProps {
  sessionId: string;
  onRated?: () => void;
}

export default function SatisfactionRating({ sessionId, onRated }: SatisfactionRatingProps) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (rating === 0) {
      MessagePlugin.warning('请选择评分');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/satisfaction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          rating,
          comment: comment || null,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setSubmitted(true);
        MessagePlugin.success('感谢您的反馈！');
        onRated?.();
      } else {
        MessagePlugin.error(data.error || '提交失败');
      }
    } catch {
      MessagePlugin.error('网络错误，请稍后再试');
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="text-center py-3" style={{ color: 'var(--td-text-color-secondary)' }}>
        <p>✅ 感谢您的反馈！您的评价将帮助我们改进服务质量。</p>
      </div>
    );
  }

  const ratingTexts = ['', '非常不满意', '不满意', '一般', '满意', '非常满意'];

  return (
    <div
      className="border-t mt-4 pt-4 px-4 pb-2"
      style={{ borderColor: 'var(--td-component-stroke)' }}
    >
      <p className="text-sm mb-2" style={{ color: 'var(--td-text-color-secondary)' }}>
        请对本次服务进行评价：
      </p>
      <div className="flex items-center gap-2 mb-2">
        <Rate
          value={rating}
          onChange={(v) => setRating(v)}
          size="20px"
        />
        {rating > 0 && (
          <span className="text-sm" style={{ color: 'var(--td-text-color-secondary)' }}>
            {ratingTexts[rating]}
          </span>
        )}
      </div>
      <Textarea
        value={comment}
        onChange={(v) => setComment(v)}
        placeholder="有什么想对我们说的？（选填）"
        maxlength={200}
        autosize={{ minRows: 2, maxRows: 3 }}
        style={{ marginBottom: 8 }}
      />
      <Button
        theme="primary"
        size="small"
        onClick={handleSubmit}
        loading={submitting}
      >
        提交评价
      </Button>
    </div>
  );
}
