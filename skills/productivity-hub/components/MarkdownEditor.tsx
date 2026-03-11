'use client';

import { useEffect, useState, useRef } from 'react';
import Vditor from 'vditor';
import 'vditor/dist/index.css';

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export default function MarkdownEditor({
  value,
  onChange,
  placeholder = 'Start writing...'
}: MarkdownEditorProps) {
  const [vd, setVd] = useState<Vditor>();
  const idRef = useRef<string>('vditor-' + Math.random().toString(36).substr(2, 9));

  useEffect(() => {
    const vditor = new Vditor(idRef.current, {
      height: 400,
      placeholder,
      value,
      cache: {
        enable: false,
      },
      after: () => {
        vditor.setValue(value);
        setVd(vditor);
      },
      input: (value) => {
        onChange(value);
      },
      toolbar: [
        'headings',
        'bold',
        'italic',
        'strike',
        '|',
        'line',
        'quote',
        'list',
        'ordered-list',
        'check',
        'outdent',
        'indent',
        '|',
        'code',
        'inline-code',
        'insert-after',
        '|',
        'upload',
        'table',
        '|',
        'undo',
        'redo',
        '|',
        'fullscreen',
        'edit-mode',
        'both',
        'code-theme',
        'content-theme',
        'export',
        'outline',
        'preview',
        'devtools'
      ],
      toolbarConfig: {
        hide: false,
      },
    });

    return () => {
      vd?.destroy();
      setVd(undefined);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (vd && value !== vd.getValue()) {
      vd.setValue(value);
    }
  }, [value, vd]);

  return (
    <div id={idRef.current} className="vditor" />
  );
}
