import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import * as XLSX from 'xlsx-republish';
import { detectFileType, wordToMarkdown, excelToMarkdown, markdownToWord } from '../document-converter';

/** Helper to create a minimal File object with a given name */
function createFile(name: string): File {
  return new File([], name);
}

const KNOWN_EXTENSIONS: Record<string, 'word' | 'excel' | 'ppt' | 'pdf'> = {
  doc: 'word',
  docx: 'word',
  xls: 'excel',
  xlsx: 'excel',
  ppt: 'ppt',
  pptx: 'ppt',
  pdf: 'pdf',
};

const KNOWN_EXT_LIST = Object.keys(KNOWN_EXTENSIONS);

describe('DocumentConverter Property Tests', () => {
  // Feature: office-preview-fix, Property 5: 无效文件输入返回失败
  // **Validates: Requirements 7.3**
  it('Property 5: wordToMarkdown and excelToMarkdown return failure for random bytes', async () => {
    // Generate random byte arrays (min length 1 to avoid empty files which might be handled differently)
    const randomBytesArb = fc.uint8Array({ minLength: 1, maxLength: 1024 });

    // Sub-property A: wordToMarkdown returns success: false for random bytes
    await fc.assert(
      fc.asyncProperty(randomBytesArb, async (bytes) => {
        const file = new File([bytes], 'random.docx', {
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        });
        const result = await wordToMarkdown(file);
        expect(result.success).toBe(false);
        expect(result.error).toBeTruthy();
      }),
      { numRuns: 100 },
    );

    // Sub-property B: excelToMarkdown returns success: false for random bytes
    await fc.assert(
      fc.asyncProperty(randomBytesArb, async (bytes) => {
        const file = new File([bytes], 'random.xlsx', {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        });
        const result = await excelToMarkdown(file);
        expect(result.success).toBe(false);
        expect(result.error).toBeTruthy();
      }),
      { numRuns: 100 },
    );
  });

  // Feature: office-preview-fix, Property 6: 文件类型检测正确性
  // **Validates: Requirements 7.4, 7.5**
  it('Property 6: detectFileType returns correct type for known extensions and unknown for others', () => {
    // Arbitrary for known extensions – pick one at random and verify the mapping
    const knownExtArb = fc.constantFrom(...KNOWN_EXT_LIST);

    // Arbitrary for unknown extensions – lowercase alphanumeric strings that are NOT in the known set
    const unknownExtArb = fc
      .stringMatching(/^[a-z0-9]{1,10}$/)
      .filter((ext) => !KNOWN_EXT_LIST.includes(ext));

    // Sub-property A: known extensions always return the correct mapped type
    fc.assert(
      fc.property(knownExtArb, (ext) => {
        const file = createFile(`file.${ext}`);
        expect(detectFileType(file)).toBe(KNOWN_EXTENSIONS[ext]);
      }),
      { numRuns: 100 },
    );

    // Sub-property B: unknown extensions always return 'unknown'
    fc.assert(
      fc.property(unknownExtArb, (ext) => {
        const file = createFile(`file.${ext}`);
        expect(detectFileType(file)).toBe('unknown');
      }),
      { numRuns: 100 },
    );
  });

  // Feature: office-preview-fix, Property 4: Excel 数据转换保真
  // **Validates: Requirements 7.2**
  it('Property 4: excelToMarkdown preserves all cell text content', async () => {
    // Generate non-empty alphanumeric cell values to avoid Markdown special chars
    const cellArb = fc.stringMatching(/^[A-Za-z0-9]{1,20}$/);

    // Generate a 2D table: at least 1 header row + 1 data row, up to 5 cols
    const tableArb = fc.record({
      headers: fc.array(cellArb, { minLength: 1, maxLength: 5 }),
      rows: fc.array(
        fc.array(cellArb, { minLength: 1, maxLength: 5 }),
        { minLength: 1, maxLength: 5 },
      ),
    });

    await fc.assert(
      fc.asyncProperty(tableArb, async ({ headers, rows }) => {
        // Normalize row lengths to match header count
        const colCount = headers.length;
        const normalizedRows = rows.map((row) =>
          row.length >= colCount ? row.slice(0, colCount) : [...row, ...Array(colCount - row.length).fill('')],
        );

        // Build a 2D array with headers as first row
        const sheetData = [headers, ...normalizedRows];

        // Create an Excel workbook using xlsx-republish
        const ws = XLSX.utils.aoa_to_sheet(sheetData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');

        // Write workbook to a buffer
        const xlsxBuffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;

        // Create a File object from the buffer
        const file = new File([xlsxBuffer], 'test.xlsx', {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        });

        // Convert to Markdown
        const result = await excelToMarkdown(file);

        expect(result.success).toBe(true);
        expect(result.markdown).toBeTruthy();

        // Verify every non-empty cell value appears in the Markdown output
        for (const cellValue of headers) {
          if (cellValue) {
            expect(result.markdown).toContain(cellValue);
          }
        }
        for (const row of normalizedRows) {
          for (const cellValue of row) {
            if (cellValue) {
              expect(result.markdown).toContain(cellValue);
            }
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  // Feature: office-preview-fix, Property 7: Markdown-Word 往返一致性
  // **Validates: Requirements 7.6**
  it('Property 7: markdownToWord then wordToMarkdown preserves text content', async () => {
    // Generate simple alphanumeric text for headings and paragraphs
    const textArb = fc.stringMatching(/^[A-Za-z0-9]{1,30}$/);

    // A heading: level 1-3 with text
    const headingArb = fc.record({
      type: fc.constant('heading' as const),
      level: fc.integer({ min: 1, max: 3 }),
      text: textArb,
    });

    // A paragraph with text
    const paragraphArb = fc.record({
      type: fc.constant('paragraph' as const),
      text: textArb,
    });

    // A document is a non-empty array of headings and paragraphs
    const docArb = fc.array(fc.oneof(headingArb, paragraphArb), { minLength: 1, maxLength: 8 });

    await fc.assert(
      fc.asyncProperty(docArb, async (blocks) => {
        // Build Markdown string from blocks
        const mdLines: string[] = [];
        for (const block of blocks) {
          if (block.type === 'heading') {
            mdLines.push(`${'#'.repeat(block.level)} ${block.text}`);
          } else {
            mdLines.push(block.text);
          }
          mdLines.push(''); // blank line between blocks
        }
        const markdown = mdLines.join('\n');

        // Convert Markdown → Word (returns a File)
        const wordFile = await markdownToWord(markdown, 'test.docx');

        // Extract ArrayBuffer from the File to pass directly to wordToMarkdown
        // (avoids Node.js File.arrayBuffer() compatibility issues with mammoth)
        const wordArrayBuffer = await wordFile.arrayBuffer();

        // Convert Word → Markdown using ArrayBuffer directly
        const result = await wordToMarkdown(wordArrayBuffer);

        expect(result.success).toBe(true);
        expect(result.markdown).toBeTruthy();

        // Verify all original text content is preserved in the round-tripped Markdown
        for (const block of blocks) {
          expect(result.markdown).toContain(block.text);
        }
      }),
      { numRuns: 100 },
    );
  });
});
