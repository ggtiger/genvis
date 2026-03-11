declare module 'easymde/dist/easymde.min.css';

declare module 'react-simplemde-editor' {
  import { Component } from 'react';
  import EasyMDE from 'easymde';

  interface SimpleMDEEditorProps {
    value: string;
    onChange: (value: string) => void;
    options?: EasyMDE.Options;
    className?: string;
  }

  export default class SimpleMDEEditor extends Component<SimpleMDEEditorProps> {}
}
