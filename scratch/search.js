const fs = require('fs');
const path = require('path');

const searchDir = (dir) => {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = path.join(dir, file);
        if (fullPath.includes('node_modules') || fullPath.includes('.git') || fullPath.includes('.gemini')) {
            continue;
        }
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
            searchDir(fullPath);
        } else if (file.endsWith('.js') || file.endsWith('.jsx')) {
            const content = fs.readFileSync(fullPath, 'utf8');
            if (content.includes('is_active')) {
                const lines = content.split('\n');
                lines.forEach((line, idx) => {
                    if (line.includes('is_active')) {
                        console.log(`${fullPath}:${idx + 1}: ${line.trim()}`);
                    }
                });
            }
        }
    }
};

const root = path.resolve(__dirname, '../..');
console.log(`Searching in ${root}`);
searchDir(root);
