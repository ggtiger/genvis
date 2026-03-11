import { describe, it, expect } from 'vitest';
import { detectFileType } from '../document-converter';

/**
 * Unit tests for detectFileType function.
 * Validates: Requirements 7.4
 *
 * Tests cover:
 * - All known extensions return the correct file type
 * - Unknown extensions return 'unknown'
 */

/** Helper to create a minimal File object with a given name */
function createFile(name: string): File {
  return new File([], name);
}

describe('detectFileType', () => {
  describe('known extensions', () => {
    it.each([
      ['report.doc', 'word'],
      ['report.docx', 'word'],
      ['data.xls', 'excel'],
      ['data.xlsx', 'excel'],
      ['slides.ppt', 'ppt'],
      ['slides.pptx', 'ppt'],
      ['document.pdf', 'pdf'],
    ] as const)('should return "%s" → "%s"', (fileName, expectedType) => {
      expect(detectFileType(createFile(fileName))).toBe(expectedType);
    });
  });

  describe('unknown extensions', () => {
    it.each([
      'readme.txt',
      'photo.jpg',
      'archive.zip',
      'style.css',
      'index.html',
    ])('should return "unknown" for %s', (fileName) => {
      expect(detectFileType(createFile(fileName))).toBe('unknown');
    });
  });
});
