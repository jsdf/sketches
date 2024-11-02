#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const directoryPath = './'; // Set your directory path here

const outputFilePath = path.join(directoryPath, 'index.html');

// Helper function to get all HTML files with their creation dates
function getHtmlFiles(dir) {
  let results = [];

  fs.readdirSync(dir, {withFileTypes: true}).forEach((file) => {
    const filePath = path.join(dir, file.name);
    if (filePath === outputFilePath) {
      return;
    }
    if (file.isDirectory()) {
      results = results.concat(getHtmlFiles(filePath));
    } else if (file.isFile() && file.name.endsWith('.html')) {
      const stats = fs.statSync(filePath);
      results.push({path: filePath, date: stats.birthtime});
    }
  });

  return results;
}

// Main function to generate index.html
function generateIndexHtml() {
  const htmlFiles = getHtmlFiles(directoryPath);

  // Sort HTML files by creation date DESC
  htmlFiles.sort((a, b) => b.date - a.date);

  // Group files by date
  const filesByDate = {};
  htmlFiles.forEach((file) => {
    const dateKey = file.date.toISOString().split('T')[0]; // Format date as YYYY-MM-DD
    if (!filesByDate[dateKey]) {
      filesByDate[dateKey] = [];
    }
    filesByDate[dateKey].push(file);
  });

  // Generate HTML content
  let htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ideas by jsdf</title>
</head>
<style>
    body {
        font-family: monospace;
        margin: 20px;
    }
    h1 {
        color: #333;
    }
    h2 {
        color: #666;
    }
    a {
        color: #007bff;
        text-decoration: none;
    }
    a:hover {
        text-decoration: underline;
    }
</style>
<body>
    <h1>ideas by jsdf</h1>
`;

  // Loop through each date and add links
  for (const [date, filesForDate] of Object.entries(filesByDate)) {
    htmlContent += `    <h2>${date}</h2>\n    <p>`;
    htmlContent += filesForDate
      .sort(
        (a, b) => a.date - b.date // Sort files by creation time ASC
      )
      .map((file, index) => {
        const relativePath = path.relative(directoryPath, file.path);
        return `<a href="${relativePath}">idea ${index + 1}</a>`;
      })
      .join(', ');
    htmlContent += `</p>\n`;
  }

  htmlContent += `
</body>
</html>
`;

  // Write index.html file
  fs.writeFileSync(outputFilePath, htmlContent, 'utf8');
  console.log('index.html has been generated.');
}

generateIndexHtml();
