'use client';

import { Pin, Trash2, Edit2, Tag, Eye } from 'lucide-react';
import { useState } from 'react';
import MarkdownPreview from './MarkdownPreview';

interface Note {
  id: string;
  title: string;
  content: string;
  tags?: string;
  isPinned: boolean;
  updatedAt: string;
}

interface NoteCardProps {
  note: Note;
  onEdit: (note: Note) => void;
  onDelete: (id: string) => void;
  onTogglePin: (id: string, isPinned: boolean) => void;
}

export default function NoteCard({ note, onEdit, onDelete, onTogglePin }: NoteCardProps) {
  const [showPreview, setShowPreview] = useState(false);

  const parseTags = (tagsString?: string): string[] => {
    if (!tagsString) return [];
    try {
      return JSON.parse(tagsString);
    } catch {
      return [];
    }
  };

  const tags = parseTags(note.tags);
  const truncatedContent = note.content.length > 150
    ? note.content.slice(0, 150) + '...'
    : note.content;

  return (
    <div className={`bg-white rounded-lg border p-4 hover:shadow-md transition-shadow ${
      note.isPinned ? 'border-amber-200 bg-amber-50/30' : 'border-gray-200'
    }`}>
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-medium text-gray-900 flex items-center gap-1">
          {note.isPinned && <Pin className="w-4 h-4 text-amber-500 fill-amber-500" />}
          {note.title}
        </h3>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={() => setShowPreview(!showPreview)}
            className={`p-1.5 rounded transition-colors ${
              showPreview
                ? 'text-green-500 hover:bg-green-100'
                : 'text-gray-400 hover:text-green-500 hover:bg-green-50'
            }`}
            title="Toggle preview"
          >
            <Eye className="w-4 h-4" />
          </button>
          <button
            onClick={() => onTogglePin(note.id, !note.isPinned)}
            className={`p-1.5 rounded transition-colors ${
              note.isPinned
                ? 'text-amber-500 hover:bg-amber-100'
                : 'text-gray-400 hover:text-amber-500 hover:bg-amber-50'
            }`}
          >
            <Pin className="w-4 h-4" />
          </button>
          <button
            onClick={() => onEdit(note)}
            className="p-1.5 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded transition-colors"
          >
            <Edit2 className="w-4 h-4" />
          </button>
          <button
            onClick={() => onDelete(note.id)}
            className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {showPreview ? (
        <div className="mt-2 p-3 bg-gray-50 rounded-lg max-h-64 overflow-y-auto">
          <MarkdownPreview content={note.content} className="text-sm" />
        </div>
      ) : (
        <p className="text-sm text-gray-600 mt-2 whitespace-pre-wrap line-clamp-3">
          {truncatedContent}
        </p>
      )}
      
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-3">
          {tags.map((tag, index) => (
            <span
              key={index}
              className="inline-flex items-center gap-0.5 px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded-full"
            >
              <Tag className="w-3 h-3" />
              {tag}
            </span>
          ))}
        </div>
      )}
      
      <p className="text-xs text-gray-400 mt-3">
        更新于 {new Date(note.updatedAt).toLocaleString('zh-CN')}
      </p>
    </div>
  );
}
