'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { FileSpreadsheet, Loader2, AlertCircle, ChevronLeft, ChevronRight } from 'lucide-react';
import { excelToMarkdown, type ExcelConversionResult, type ExcelSheet } from '@/lib/services/document-converter';
import * as XLSX from 'xlsx-republish';

interface ExcelPreviewProps {
  file: File;
  onError?: (error: string) => void;
  onSave?: (file: File) => Promise<void>;
  editable?: boolean;
  onToolbarChange?: (toolbar: {
    onSave?: () => void;
    onEdit?: () => void;
    onCancelEdit?: () => void;
    onDownload?: () => void;
    hasChanges?: boolean;
    saving?: boolean;
    isEditing?: boolean;
  } | null) => void;
}

export default function ExcelPreview({ file, onError, onSave, editable = false, onToolbarChange }: ExcelPreviewProps) {
  const [sheets, setSheets] = useState<ExcelSheet[]>([]);
  const [currentSheetIndex, setCurrentSheetIndex] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');
  const [editingCell, setEditingCell] = useState<{ row: number; col: number } | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const [hasChanges, setHasChanges] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Refs to hold latest implementations — avoids unstable deps in toolbar effect
  const saveRef = useRef<() => void>(() => {});
  const downloadRef = useRef<() => void>(() => {});
  const onToolbarChangeRef = useRef(onToolbarChange);
  onToolbarChangeRef.current = onToolbarChange;

  useEffect(() => {
    let cancelled = false;

    async function convertDocument() {
      setLoading(true);
      setError('');
      
      try {
        const result: ExcelConversionResult = await excelToMarkdown(file);
        
        if (cancelled) return;

        if (result.success) {
          setSheets(result.sheets);
          setCurrentSheetIndex(0);
        } else {
          const errorMsg = result.error || 'Excel 文档转换失败';
          setError(errorMsg);
          onError?.(errorMsg);
        }
      } catch (err) {
        if (cancelled) return;
        const errorMsg = err instanceof Error ? err.message : '未知错误';
        setError(errorMsg);
        onError?.(errorMsg);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    convertDocument();
    return () => { cancelled = true; };
  }, [file]);

  useEffect(() => {
    if (editingCell && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingCell]);

  const handleCellDoubleClick = (rowIndex: number, colIndex: number) => {
    if (!editable) return;
    const cellValue = currentSheet.data[rowIndex + 1]?.[colIndex];
    setEditingCell({ row: rowIndex, col: colIndex });
    setEditValue(String(cellValue ?? ''));
  };

  const handleCellChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEditValue(e.target.value);
  };

  const handleCellBlur = () => {
    if (editingCell) saveCellValue();
  };

  const handleCellKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') saveCellValue();
    else if (e.key === 'Escape') setEditingCell(null);
  };

  const saveCellValue = () => {
    if (!editingCell) return;
    const newSheets = [...sheets];
    const rowIndex = editingCell.row + 1;
    const colIndex = editingCell.col;
    if (newSheets[currentSheetIndex].data[rowIndex]) {
      newSheets[currentSheetIndex].data[rowIndex][colIndex] = editValue;
      setSheets(newSheets);
      setHasChanges(true);
    }
    setEditingCell(null);
  };

  // Keep refs up to date with latest closures
  saveRef.current = async () => {
    if (!onSave || !hasChanges) return;
    setSaving(true);
    try {
      const workbook = XLSX.utils.book_new();
      sheets.forEach((sheet) => {
        const worksheet = XLSX.utils.aoa_to_sheet(sheet.data);
        XLSX.utils.book_append_sheet(workbook, worksheet, sheet.name);
      });
      const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
      const blob = new Blob([excelBuffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const newFile = new File([blob], file.name, { type: blob.type });
      await onSave(newFile);
      setHasChanges(false);
    } catch (err) {
      onError?.(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  downloadRef.current = () => {
    const workbook = XLSX.utils.book_new();
    sheets.forEach((sheet) => {
      const worksheet = XLSX.utils.aoa_to_sheet(sheet.data);
      XLSX.utils.book_append_sheet(workbook, worksheet, sheet.name);
    });
    const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([excelBuffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = file.name;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Stable wrapper functions
  const stableSave = useCallback(() => { saveRef.current(); }, []);
  const stableDownload = useCallback(() => { downloadRef.current(); }, []);

  // Expose toolbar — only re-fires when primitive state values change
  useEffect(() => {
    if (!loading && !error) {
      onToolbarChangeRef.current?.({
        onSave: stableSave,
        onDownload: stableDownload,
        hasChanges,
        saving,
      });
    } else {
      onToolbarChangeRef.current?.(null);
    }
  }, [loading, error, hasChanges, saving]);

  // Cleanup on unmount
  useEffect(() => {
    return () => { onToolbarChangeRef.current?.(null); };
  }, []);

  const currentSheet = sheets[currentSheetIndex];

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[400px] bg-white">
        <Loader2 className="w-8 h-8 text-gray-400 animate-spin mb-3" />
        <p className="text-sm text-gray-500">正在解析 Excel 文档...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[400px] bg-white">
        <AlertCircle className="w-8 h-8 text-red-500 mb-3" />
        <p className="text-sm text-red-600 mb-2">文档解析失败</p>
        <p className="text-xs text-gray-500">{error}</p>
      </div>
    );
  }

  if (sheets.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[400px] bg-white">
        <FileSpreadsheet className="w-8 h-8 text-gray-400 mb-3" />
        <p className="text-sm text-gray-500">工作簿为空</p>
      </div>
    );
  }

  return (
    <div className="h-full bg-white overflow-hidden flex flex-col">
      {sheets.length > 1 && (
        <div className="flex items-center gap-2 px-6 py-2 bg-gray-50 border-b border-gray-200">
          <button
            onClick={() => setCurrentSheetIndex(Math.max(0, currentSheetIndex - 1))}
            disabled={currentSheetIndex === 0}
            className="p-1 rounded hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-1">
            {sheets.map((sheet, index) => (
              <button
                key={index}
                onClick={() => setCurrentSheetIndex(index)}
                className={`px-3 py-1 text-xs rounded transition-colors ${
                  index === currentSheetIndex
                    ? 'bg-gray-800 text-white font-medium'
                    : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-300'
                }`}
              >
                {sheet.name}
              </button>
            ))}
          </div>
          <button
            onClick={() => setCurrentSheetIndex(Math.min(sheets.length - 1, currentSheetIndex + 1))}
            disabled={currentSheetIndex === sheets.length - 1}
            className="p-1 rounded hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="flex-1 overflow-auto p-6">
        {currentSheet && currentSheet.data.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse border border-gray-300 text-sm">
              <thead>
                <tr className="bg-gray-100">
                  {currentSheet.data[0].map((header, colIndex) => (
                    <th key={colIndex} className="border border-gray-300 px-4 py-2 text-left font-semibold text-gray-700">
                      {String(header || '')}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {currentSheet.data.slice(1).map((row, rowIndex) => (
                  <tr key={rowIndex} className={rowIndex % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    {row.map((cell, cellIndex) => (
                      <td
                        key={cellIndex}
                        className={`border border-gray-300 px-4 py-2 text-gray-700 ${editable ? 'cursor-pointer hover:bg-blue-50' : ''}`}
                        onDoubleClick={() => handleCellDoubleClick(rowIndex, cellIndex)}
                      >
                        {editingCell?.row === rowIndex && editingCell?.col === cellIndex ? (
                          <input
                            ref={inputRef}
                            type="text"
                            value={editValue}
                            onChange={handleCellChange}
                            onBlur={handleCellBlur}
                            onKeyDown={handleCellKeyDown}
                            className="w-full bg-white border border-blue-500 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        ) : (
                          String(cell ?? '')
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-gray-500">当前工作表为空</p>
          </div>
        )}
      </div>

      {currentSheet && currentSheet.data.length > 0 && (
        <div className="px-6 py-2 bg-gray-50 border-t border-gray-200 text-xs text-gray-500">
          共 {currentSheet.data.length - 1} 行数据 × {currentSheet.data[0].length} 列
        </div>
      )}
    </div>
  );
}
