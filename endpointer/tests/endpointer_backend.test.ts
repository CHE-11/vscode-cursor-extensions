import { describe, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// **********************************************************************
// * Vitest Test to check for ENDPOINTER comments in the backend code?
// **********************************************************************

const routesFolder = path.resolve(__dirname, '..', 'routes');
const routeExt = '.handler.ts'
const excludeDirectories: string[] = [];

console.log('Routes folder: ', routesFolder);

describe('Backend API calls must have ENDPOINTER reference', () => {
  it('should have Endpointer comment in the route file', () => {
    const violations: string[] = [];
    
    function isExcludedPath(targetPath: string) {
      const rel = path.relative(routesFolder, targetPath).split(path.sep).join('/');
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
        } else if (file.endsWith(routeExt)) {
          checkFile(filePath);
        }
      }
    }
    
    function checkFile(filePath: string) {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      const hasBackendEndpointer = lines.some(line => line.includes('ENDPOINTER') && line.includes('<backend>'));
      if (!hasBackendEndpointer) {
        const relativePath = path.relative(routesFolder, filePath);
        violations.push(`${relativePath}`);
      }
    }
    
    scanDirectory(routesFolder);
    
    if (violations.length > 0) {
      console.warn('\n⚠️  Found API route without Endpointer comment:\n');
      violations.forEach(v => console.warn(v));
      console.warn(`\nTotal violations: ${violations.length}`);
      throw new Error(`Found ${violations.length} API routes without Endpointer comment`);
    }
  });
});
