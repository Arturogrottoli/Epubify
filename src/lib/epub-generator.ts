import JSZip from "jszip";

export async function generateEpub(
  title: string, 
  author: string, 
  chapters: { title: string, content: string }[]
): Promise<Blob> {
  const zip = new JSZip();

  // Root mimetype
  zip.file("mimetype", "application/epub+zip");

  // META-INF/container.xml
  const containerXml = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;
  zip.folder("META-INF")?.file("container.xml", containerXml);

  // OEBPS/content.opf
  let manifest = "";
  let spine = "";
  
  chapters.forEach((chapter, index) => {
    manifest += `    <item id="chapter${index}" href="chapter${index}.xhtml" media-type="application/xhtml+xml" />\n`;
    spine += `    <itemref idref="chapter${index}" />\n`;
  });

  const contentOpf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>${title.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</dc:title>
    <dc:creator>${author.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</dc:creator>
    <dc:language>en</dc:language>
    <dc:identifier id="BookId">urn:uuid:${crypto.randomUUID()}</dc:identifier>
  </metadata>
  <manifest>
    <item id="toc" href="toc.ncx" media-type="application/x-dtbncx+xml" />
${manifest}  </manifest>
  <spine toc="toc">
${spine}  </spine>
</package>`;

  const oebps = zip.folder("OEBPS");
  oebps?.file("content.opf", contentOpf);

  // OEBPS/toc.ncx
  let navPoints = "";
  chapters.forEach((chapter, index) => {
    navPoints += `
    <navPoint id="navPoint-${index}" playOrder="${index + 1}">
      <navLabel><text>${chapter.title.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text></navLabel>
      <content src="chapter${index}.xhtml" />
    </navPoint>`;
  });

  const tocNcx = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="urn:uuid:${crypto.randomUUID()}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${title.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text></docTitle>
  <navMap>
${navPoints}
  </navMap>
</ncx>`;
  oebps?.file("toc.ncx", tocNcx);

  // Chapters Xthml Files
  chapters.forEach((chapter, index) => {
    const safeTitle = chapter.title.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    let contentSafe = chapter.content;
    
    // Quick and dirty formatter if content isn't HTML
    if (!contentSafe.includes('<p>') && !contentSafe.includes('<h1>')) {
        contentSafe = contentSafe
            .split('\\n')
            .filter(p => p.trim() !== '')
            .map(p => `<p>${p.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p>`)
            .join('\\n');
    } else {
        // Just make sure there are no unclosed bare amps that break XML (rough check)
        // Usually mammoth/cheerio output is fairly safe, but pure XML needs rigour.
        // We'll trust mammoth/cheerio output for valid nested elements mostly.
    }

    const htmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <title>${safeTitle}</title>
</head>
<body>
  <h1>${safeTitle}</h1>
  ${contentSafe}
</body>
</html>`;
    oebps?.file(`chapter${index}.xhtml`, htmlContent);
  });

  return zip.generateAsync({ type: "blob", mimeType: "application/epub+zip", compression: "DEFLATE" });
}
