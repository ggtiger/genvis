/**
 * 文档转换服务
 * 基于 AionUi 的 Markdown 中心化架构
 * 支持 Word/Excel 文档与 Markdown 的双向转换
 */

import mammoth from 'mammoth';
import * as XLSX from 'xlsx-republish';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import { marked } from 'marked';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } from 'docx';

// ============================================================================
// 类型定义
// ============================================================================

export interface DocumentMetadata {
  title?: string;
  author?: string;
  createdDate?: Date;
  modifiedDate?: Date;
  pageCount?: number;
}

export interface ConversionResult {
  markdown: string;
  metadata?: DocumentMetadata;
  success: boolean;
  error?: string;
}

export interface ExcelSheet {
  name: string;
  data: any[][];
  markdown: string;
}

export interface ExcelConversionResult {
  sheets: ExcelSheet[];
  markdown: string; // 所有 sheets 合并的 markdown
  success: boolean;
  error?: string;
}

// ============================================================================
// Word 文档处理
// ============================================================================

/**
 * Word 文档转 Markdown
 * 使用 mammoth 解析 .docx 文件,通过 turndown 转换为 Markdown
 */
export async function wordToMarkdown(file: File | ArrayBuffer): Promise<ConversionResult> {
  try {
    const arrayBuffer = file instanceof File ? await file.arrayBuffer() : file;
    
    // mammoth expects { buffer } (Node Buffer) — see mammoth/lib/unzip.js
    // Always create a fresh copy to avoid detached/shared ArrayBuffer issues
    const buffer = Buffer.from(new Uint8Array(arrayBuffer));
    
    // 使用 mammoth 转换为 HTML
    const result = await mammoth.convertToHtml(
      { buffer },
      {
        styleMap: [
          // 保留标题层级
          "p[style-name='Heading 1'] => h1:fresh",
          "p[style-name='Heading 2'] => h2:fresh",
          "p[style-name='Heading 3'] => h3:fresh",
          "p[style-name='Heading 4'] => h4:fresh",
          "p[style-name='Heading 5'] => h5:fresh",
          "p[style-name='Heading 6'] => h6:fresh",
        ],
        convertImage: mammoth.images.imgElement(function(image) {
          // 将图片转为 base64 data URL
          return image.read("base64").then(function(imageBuffer) {
            return {
              src: "data:" + image.contentType + ";base64," + imageBuffer
            };
          });
        })
      }
    );

    // 使用 turndown 转换为 Markdown
    const turndownService = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      bulletListMarker: '-',
    });
    
    // 添加 GFM 插件支持表格、任务列表等
    turndownService.use(gfm);

    const markdown = turndownService.turndown(result.value);

    return {
      markdown,
      success: true,
    };
  } catch (error) {
    console.error('Word 转 Markdown 失败:', error);
    return {
      markdown: '',
      success: false,
      error: error instanceof Error ? error.message : '未知错误',
    };
  }
}

// ============================================================================
// Excel 文档处理
// ============================================================================

/**
 * 将 Excel 单元格数据转换为 Markdown 表格
 */
function sheetToMarkdown(sheet: XLSX.WorkSheet, sheetName: string): string {
  const data: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });
  
  if (data.length === 0) {
    return `## ${sheetName}

_空工作表_

`;
  }

  let markdown = `## ${sheetName}\n\n`;

  // 表头
  const headers = data[0] || [];
  markdown += '| ' + headers.map(h => String(h || '')).join(' | ') + ' |\n';
  
  // 分隔线
  markdown += '| ' + headers.map(() => '---').join(' | ') + ' |\n';

  // 数据行
  for (let i = 1; i < data.length; i++) {
    const row = data[i] || [];
    markdown += '| ' + row.map(cell => String(cell ?? '')).join(' | ') + ' |\n';
  }

  markdown += '\n';
  return markdown;
}

/**
 * Excel 文档转 Markdown
 * 使用 xlsx-republish 读取工作簿,转换为 Markdown 表格
 */
export async function excelToMarkdown(file: File | ArrayBuffer): Promise<ExcelConversionResult> {
  try {
    const arrayBuffer = file instanceof File ? await file.arrayBuffer() : file;
    const bytes = new Uint8Array(arrayBuffer);

    // 验证文件至少包含有效的 Excel 文件签名
    // XLSX (ZIP) 以 PK (0x50, 0x4B) 开头; XLS (OLE2) 以 0xD0, 0xCF 开头
    const isZip = bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4B;
    const isOLE2 = bytes.length >= 2 && bytes[0] === 0xD0 && bytes[1] === 0xCF;
    if (!isZip && !isOLE2) {
      return {
        sheets: [],
        markdown: '',
        success: false,
        error: '无效的 Excel 文件格式',
      };
    }

    // 读取工作簿
    const workbook = XLSX.read(bytes, { type: 'array' });

    const sheets: ExcelSheet[] = [];
    let combinedMarkdown = '# Excel 工作簿\n\n';

    // 遍历所有工作表
    for (const sheetName of workbook.SheetNames) {
      const worksheet = workbook.Sheets[sheetName];
      const sheetData: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
      const sheetMarkdown = sheetToMarkdown(worksheet, sheetName);

      sheets.push({
        name: sheetName,
        data: sheetData,
        markdown: sheetMarkdown,
      });

      combinedMarkdown += sheetMarkdown;
    }

    return {
      sheets,
      markdown: combinedMarkdown,
      success: true,
    };
  } catch (error) {
    console.error('Excel 转 Markdown 失败:', error);
    return {
      sheets: [],
      markdown: '',
      success: false,
      error: error instanceof Error ? error.message : '未知错误',
    };
  }
}

// ============================================================================
// Markdown 处理
// ============================================================================

/**
 * Markdown 转 HTML
 * 简单转换,主要用于预览
 */
export function markdownToHTML(markdown: string): string {
  // 这里使用简单的转换逻辑
  // 实际渲染由 react-markdown 处理
  return markdown
    .replace(/^### (.*$)/gim, '<h3>$1</h3>')
    .replace(/^## (.*$)/gim, '<h2>$1</h2>')
    .replace(/^# (.*$)/gim, '<h1>$1</h1>')
    .replace(/\*\*(.*)\*\*/gim, '<strong>$1</strong>')
    .replace(/\*(.*)\*/gim, '<em>$1</em>')
    .replace(/\n$/gim, '<br />');
}

/**
 * 解析 Markdown 表格
 * 从 Markdown 中提取表格数据
 */
export function parseMarkdownTables(markdown: string): Array<{ headers: string[]; rows: string[][] }> {
  const tables: Array<{ headers: string[]; rows: string[][] }> = [];
  const lines = markdown.split('\n');
  
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    
    // 检测表格开始 (格式: | header1 | header2 |)
    if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
      const headerLine = line;
      const separatorLine = lines[i + 1];
      
      // 验证分隔线
      if (separatorLine && /^\|[\s-:|]+\|$/.test(separatorLine.trim())) {
        const headers = headerLine
          .split('|')
          .slice(1, -1)
          .map(h => h.trim());
        
        const rows: string[][] = [];
        let j = i + 2;
        
        // 读取数据行
        while (j < lines.length && lines[j].trim().startsWith('|') && lines[j].trim().endsWith('|')) {
          const cells = lines[j]
            .split('|')
            .slice(1, -1)
            .map(c => c.trim());
          rows.push(cells);
          j++;
        }
        
        tables.push({ headers, rows });
        i = j;
        continue;
      }
    }
    i++;
  }
  
  return tables;
}

// ============================================================================
// 文件类型检测
// ============================================================================

export function detectFileType(file: File): 'word' | 'excel' | 'ppt' | 'pdf' | 'unknown' {
  const ext = file.name.split('.').pop()?.toLowerCase();
  
  switch (ext) {
    case 'doc':
    case 'docx':
      return 'word';
    case 'xls':
    case 'xlsx':
      return 'excel';
    case 'ppt':
    case 'pptx':
      return 'ppt';
    case 'pdf':
      return 'pdf';
    default:
      return 'unknown';
  }
}

// ============================================================================
// 统一转换接口
// ============================================================================

export async function convertDocumentToMarkdown(
  file: File
): Promise<ConversionResult | ExcelConversionResult> {
  const fileType = detectFileType(file);
  
  switch (fileType) {
    case 'word':
      return wordToMarkdown(file);
    case 'excel':
      return excelToMarkdown(file);
    default:
      return {
        markdown: '',
        success: false,
        error: `不支持的文件类型: ${fileType}`,
      };
  }
}

// ============================================================================
// Markdown → Word 转换（编辑后保存）
// ============================================================================

/**
 * Markdown 转 Word 文档
 * 使用 docx 库生成 .docx 文件
 */
export async function markdownToWord(markdown: string, fileName: string = 'document.docx'): Promise<File> {
  try {
    // 解析 Markdown 为 tokens
    const tokens = marked.lexer(markdown);
    const paragraphs: Paragraph[] = [];

    // 遍历 tokens 生成段落
    for (const token of tokens) {
      if (token.type === 'heading') {
        const level = token.depth as 1 | 2 | 3 | 4 | 5 | 6;
        const headingLevel = [
          HeadingLevel.HEADING_1,
          HeadingLevel.HEADING_2,
          HeadingLevel.HEADING_3,
          HeadingLevel.HEADING_4,
          HeadingLevel.HEADING_5,
          HeadingLevel.HEADING_6,
        ][level - 1];

        paragraphs.push(
          new Paragraph({
            text: token.text,
            heading: headingLevel,
          })
        );
      } else if (token.type === 'paragraph') {
        paragraphs.push(
          new Paragraph({
            children: [new TextRun(token.text)],
          })
        );
      } else if (token.type === 'list') {
        // 处理列表
        for (const item of token.items) {
          paragraphs.push(
            new Paragraph({
              text: `• ${item.text}`,
              bullet: {
                level: 0,
              },
            })
          );
        }
      } else if (token.type === 'code') {
        paragraphs.push(
          new Paragraph({
            children: [
              new TextRun({
                text: token.text,
                font: 'Courier New',
              }),
            ],
          })
        );
      }
    }

    // 创建 Word 文档
    const doc = new Document({
      sections: [
        {
          properties: {},
          children: paragraphs,
        },
      ],
    });

    // 生成 Buffer
    const buffer = await Packer.toBuffer(doc);
    
    // 转换为 File 对象
    const blob = new Blob([new Uint8Array(buffer)], {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    return new File([blob], fileName, { type: blob.type });
  } catch (error) {
    console.error('Markdown 转 Word 失败:', error);
    throw error;
  }
}
