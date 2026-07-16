import { useState, useId, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { GLOSSARY, type GlossaryKey } from '../../lib/glossary';

// Inline, keyboard-focusable glossary term: dotted underline, a hover/focus tooltip with a
// short definition, and a click-through to the relevant Methodology section. Reduced-motion
// is handled globally (index.css). Reuse for any jargon a first-timer might not know.
export function Term({ k, children }: { k: GlossaryKey; children?: ReactNode }) {
  const g = GLOSSARY[k];
  const [show, setShow] = useState(false);
  const id = useId();

  return (
    <span className="relative inline-block">
      <Link
        to={`/methodology#${g.anchor}`}
        className="border-b border-dotted border-gray-500 hover:border-benchmark-400 cursor-help transition-colors"
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        onFocus={() => setShow(true)}
        onBlur={() => setShow(false)}
        aria-describedby={show ? id : undefined}
      >
        {children ?? g.term}
      </Link>
      {show && (
        <span
          role="tooltip"
          id={id}
          className="absolute z-[60] bottom-full left-0 mb-1.5 w-60 glass p-2.5 text-left animate-fade-in-down pointer-events-none"
        >
          <span className="block text-xs font-semibold text-white">{g.term}</span>
          <span className="block text-[11px] text-gray-400 mt-0.5 leading-relaxed">{g.def}</span>
          <span className="block text-[10px] text-benchmark-400 mt-1.5">Read the methodology →</span>
        </span>
      )}
    </span>
  );
}
