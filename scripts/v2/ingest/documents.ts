/**
 * Document text extraction for PPTX, DOCX, XLSX, and JS files.
 *
 * Produces DocumentArtifact objects from files in a deal's outputs/ directory.
 */

import { readdir, stat } from "node:fs/promises";
import { join, extname, basename, resolve } from "node:path";
import * as mammoth from "mammoth";
import * as JSZip from "jszip";
import type { DocumentArtifact } from "../../../src/types/benchmark-v2";

// ---------------------------------------------------------------------------
// Text extraction per format
// ---------------------------------------------------------------------------

/** Strip XML tags and collapse whitespace */
function stripXml(xml: string): string {
  return xml
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** Extract text from a DOCX file using mammoth */
async function extractDocx(filePath: string): Promise<string> {
  const buffer = await Bun.file(filePath).arrayBuffer();
  const result = await mammoth.extractRawText({ buffer: Buffer.from(buffer) });
  return result.value.trim();
}

/** Extract text from a PPTX file by parsing slide XML */
async function extractPptx(filePath: string): Promise<string> {
  const buffer = await Bun.file(filePath).arrayBuffer();
  const zip = await JSZip.loadAsync(buffer);

  // Collect slide files sorted by number
  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => {
      const numA = parseInt(a.match(/slide(\d+)/)?.[1] ?? "0");
      const numB = parseInt(b.match(/slide(\d+)/)?.[1] ?? "0");
      return numA - numB;
    });

  const parts: string[] = [];
  for (const slidePath of slideFiles) {
    const file = zip.files[slidePath];
    if (!file) continue;
    const xml = await file.async("text");
    const text = stripXml(xml);
    if (text) {
      parts.push(text);
    }
  }
  return parts.join("\n\n");
}

/** Extract text from an XLSX file by reading shared strings and sheet data */
async function extractXlsx(filePath: string): Promise<string> {
  const buffer = await Bun.file(filePath).arrayBuffer();
  const zip = await JSZip.loadAsync(buffer);

  // Read shared strings (most cell text lives here)
  const sharedStrings: string[] = [];
  const ssFile = zip.files["xl/sharedStrings.xml"];
  if (ssFile) {
    const ssXml = await ssFile.async("text");
    // Extract <t> tag contents
    const matches = ssXml.matchAll(/<t[^>]*>([^<]*)<\/t>/g);
    for (const m of matches) {
      if (m[1]) sharedStrings.push(m[1]);
    }
  }

  // Read sheet data for inline values
  const sheetFiles = Object.keys(zip.files)
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort((a, b) => {
      const numA = parseInt(a.match(/sheet(\d+)/)?.[1] ?? "0");
      const numB = parseInt(b.match(/sheet(\d+)/)?.[1] ?? "0");
      return numA - numB;
    });

  const rows: string[] = [];
  for (const sheetPath of sheetFiles) {
    const sheetFile = zip.files[sheetPath];
    if (!sheetFile) continue;
    const xml = await sheetFile.async("text");
    // Extract cell values - both shared string refs and inline values
    const cellMatches = xml.matchAll(/<c[^>]*(?:t="s"[^>]*)?>.*?<v>(\d+)<\/v>.*?<\/c>/gs);
    for (const cm of cellMatches) {
      const val = cm[1];
      if (val === undefined) continue;
      const idx = parseInt(val);
      if (sharedStrings[idx]) {
        rows.push(sharedStrings[idx]);
      }
    }
    // Also grab inline strings
    const inlineMatches = xml.matchAll(/<c[^>]*t="inlineStr"[^>]*>.*?<is>.*?<t>([^<]+)<\/t>.*?<\/is>.*?<\/c>/gs);
    for (const im of inlineMatches) {
      if (im[1]) rows.push(im[1]);
    }
    // Grab direct numeric values (cells without t="s")
    const numMatches = xml.matchAll(/<c(?![^>]*t="s")[^>]*><v>([^<]+)<\/v><\/c>/gs);
    for (const nm of numMatches) {
      if (nm[1]) rows.push(nm[1]);
    }
  }

  // If shared strings provided decent text, return those; otherwise combine
  if (rows.length > 0) {
    return rows.join(" | ").trim();
  }
  if (sharedStrings.length > 0) {
    return sharedStrings.join(" | ").trim();
  }
  return "";
}

/** Read a JS/MD/text file as-is */
async function extractTextFile(filePath: string): Promise<string> {
  return await Bun.file(filePath).text();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

type DocType = DocumentArtifact["documentType"];

const EXTENSION_MAP: Record<string, DocType> = {
  ".docx": "docx",
  ".pptx": "pptx",
  ".xlsx": "xlsx",
  ".pdf": "pdf",
};

const SUPPORTED_EXTENSIONS = new Set([
  ".docx",
  ".pptx",
  ".xlsx",
  ".js",
  ".md",
]);

/**
 * Extract text from a single file. Returns the extracted text content.
 * Throws on unsupported or unparseable files.
 */
export async function extractDocumentText(filePath: string): Promise<string> {
  const ext = extname(filePath).toLowerCase();

  switch (ext) {
    case ".docx":
      return extractDocx(filePath);
    case ".pptx":
      return extractPptx(filePath);
    case ".xlsx":
      return extractXlsx(filePath);
    case ".js":
    case ".md":
      return extractTextFile(filePath);
    default:
      throw new Error(`Unsupported file extension: ${ext}`);
  }
}

/** Sanitize a filename for use as an ID component */
function sanitizeForId(name: string): string {
  return name
    .replace(/\.[^.]+$/, "") // strip extension
    .replace(/[^a-zA-Z0-9_-]/g, "-") // replace non-alphanumeric
    .replace(/-+/g, "-") // collapse dashes
    .replace(/^-|-$/g, ""); // trim dashes
}

/**
 * Ingest all documents from a deal directory's outputs/ folder.
 * Returns an array of DocumentArtifact objects.
 */
export async function ingestDocuments(
  dealDir: string,
  dealId: string
): Promise<DocumentArtifact[]> {
  const outputsDir = join(dealDir, "outputs");
  const artifacts: DocumentArtifact[] = [];

  let entries: string[];
  try {
    entries = await readdir(outputsDir);
  } catch {
    console.warn(`[documents] No outputs directory found: ${outputsDir}`);
    return [];
  }

  for (const entry of entries) {
    const ext = extname(entry).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(ext)) continue;

    const filePath = join(outputsDir, entry);

    // Skip directories (e.g. slides-v2/, node_modules/)
    const fileStat = await stat(filePath).catch(() => null);
    if (!fileStat || fileStat.isDirectory()) continue;

    // Skip empty files
    if (fileStat.size === 0) {
      console.warn(`[documents] Skipping empty file: ${entry}`);
      continue;
    }

    try {
      const content = await extractDocumentText(filePath);
      if (!content.trim()) {
        console.warn(`[documents] No text extracted from: ${entry}`);
        continue;
      }

      const docType: DocType = EXTENSION_MAP[ext] ?? "other";
      const sanitized = sanitizeForId(entry);

      artifacts.push({
        id: `doc_${dealId}_${sanitized}`,
        dealId,
        type: "document",
        title: basename(entry, ext),
        documentType: docType,
        content,
        sourceFile: resolve(filePath),
        createdAt: fileStat.mtime.toISOString(),
        anonymized: false,
      });
    } catch (err) {
      console.warn(
        `[documents] Failed to extract text from ${entry}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  console.log(
    `[documents] Extracted ${artifacts.length} documents from ${outputsDir}`
  );
  return artifacts;
}
