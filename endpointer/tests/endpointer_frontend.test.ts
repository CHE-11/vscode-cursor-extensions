import { describe, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// **********************************************************************
// Vitest Test to check for ENDPOINTER comments in the frontend code?
// **********************************************************************

const srcDir = path.resolve(__dirname, '..');     // Directory to scan for ENDPOINTER comments?
const excludeDirectories = ['tests', 'types/AI']; // Directories to exclude from scanning?                    
const includeExtensions: string[] = [];           // Extensions to include in scanning?
const api_url_matching = ['fetch(', 'import.meta.env.VITE_API_ENDPOINT']; // Strings to match in the file to determine if it is a frontend API call?

console.log('Src folder: ', srcDir);

describe('Frontend API calls must have ENDPOINTER reference', () => {
  it('should have ENDPOINTER comment above all v1/ API calls', () => {
    const violations: string[] = [];
    
    function isExcludedPath(targetPath: string) {
      const rel = path.relative(srcDir, targetPath).split(path.sep).join('/');
      return excludeDirectories.some(ex => rel === ex || rel.startsWith(ex + '/'));
    }

    function scanDirectory(dir: string) {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        const filePath = path.join(dir, file);
        if (isExcludedPath(filePath)) continue;
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
          scanDirectory(filePath);
        } else if (includeExtensions.length === 0) {
          checkFile(filePath);
        } else if (includeExtensions.length > 0 && includeExtensions.includes(path.extname(file))) {
          checkFile(filePath);
        }
      }
    }
    
    function checkFile(filePath: string) {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      const usedEndpointerLines = new Set<number>();
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        // Look for fetch calls based on the api_url_matching array
        if (api_url_matching.some(match => line.includes(match))) {
          // Check previous 3 lines for ENDPOINTER comment
          let hasEndpointer = false;
          let endpointerLineIndex = -1;
          
          for (let j = 1; j <= 3; j++) {
            if (i - j >= 0) {
              const prevLine = lines[i - j].trim();
              if (prevLine.includes('ENDPOINTER') && prevLine.includes('<frontend>')) {
                endpointerLineIndex = i - j;
                break;
              }
            }
          }
          
          // Check if we found an ENDPOINTER comment and it hasn't been used yet
          if (endpointerLineIndex >= 0 && !usedEndpointerLines.has(endpointerLineIndex)) {
            hasEndpointer = true;
            usedEndpointerLines.add(endpointerLineIndex);
          }
          
          if (!hasEndpointer) {
            const relativePath = path.relative(srcDir, filePath);
            violations.push(`${relativePath}:${i + 1} - ext: ${path.extname(filePath)}`);
          }
        }
      }
    }
    
    scanDirectory(srcDir);
    
    if (violations.length > 0) {
      console.warn('\n⚠️  Found API calls without ENDPOINTER comment:\n');
      violations.forEach(v => console.warn(v));
      console.warn(`\nTotal violations: ${violations.length}`);
      throw new Error(`Found ${violations.length} API calls without ENDPOINTER comment`);
    }
  });
});
