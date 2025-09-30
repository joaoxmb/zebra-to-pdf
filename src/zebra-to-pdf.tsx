import JSZip from "jszip";
import fs from "fs";
import fetch from "node-fetch";
import readline from "readline";
import { exec } from "child_process";
import {
  closeMainWindow,
  getFrontmostApplication,
  showHUD,
} from "@raycast/api";
import { showLoadingHUD } from "./utils/common-utils";
import { finderBundleId } from "./utils/constants";
import { copyFinderPath } from "./utils/common-utils";

function removeLastFromPath(pathStr: string) {
  return pathStr.replace(/\/+$/, "").replace(/\/[^/]+$/, "");
}

// Função para gerar PDF via Labelary
async function gerarPDF(zebra: string[]): Promise<Buffer> {
  const zpl = zebra.join("\n");
  if (!zpl.includes("^XA") || !zpl.includes("^XZ")) {
    throw new Error("Conteúdo não é um ZPL válido!");
  }

  const url = "http://api.labelary.com/v1/printers/8dpmm/labels/4x6/";
  const response = await fetch(url, {
    method: "POST",
    body: zpl,
    headers: {
      Accept: "application/pdf",
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Labelary API error: ${response.status} - ${text}`);
  }

  const buffer = await response.arrayBuffer();
  return Buffer.from(buffer);
}

// Função para abrir PDF no app padrão (macOS)
function abrirPDF(caminho: string) {
  exec(`open "${caminho}"`, (err) => {
    if (err) console.error("Erro ao abrir o PDF:", err);
    else console.log("PDF aberto para visualização/impressão:", caminho);
  });
}

// Processa arquivo normal (não zip)
async function processFile(filePath: string) {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

  if (!lines.some((line) => line.includes("^XA") && line.includes("^XZ"))) {
    throw new Error("O arquivo selecionado não contém ZPL válido!");
  }

  console.log("Arquivo normal processado:", filePath);
  const pdf = await gerarPDF(lines);
  const outputPath = removeLastFromPath(filePath);
  const pdfPath = outputPath + "/label.pdf";
  fs.writeFileSync(pdfPath, pdf);
  console.log("PDF salvo em:", pdfPath);

  abrirPDF(pdfPath);
}

// Processa arquivos ZIP
async function processZip(filePath: string) {
  const data = fs.readFileSync(filePath);
  const zip = await JSZip.loadAsync(data);

  const fileKeys = Object.keys(zip.files);
  if (fileKeys.length === 0) throw new Error("ZIP está vazio!");

  for (const key of fileKeys) {
    const zipFile = zip.file(key);
    if (!zipFile) continue;

    const stream = zipFile.nodeStream();
    const rl = readline.createInterface({
      input: stream,
      crlfDelay: Infinity,
    });

    const zebra: string[] = [];
    for await (const line of rl) {
      zebra.push(line.trim());
    }

    if (!zebra.some((line) => line.includes("^XA") && line.includes("^XZ"))) {
      throw new Error(`O arquivo "${key}" dentro do ZIP não contém ZPL válido!`);
    }

    console.log("Arquivo processado no ZIP:", key);
    const pdf = await gerarPDF(zebra);
    const outputPath = removeLastFromPath(filePath);
    const pdfPath = outputPath + `/${key.replace(/\.[^/.]+$/, "")}.pdf`;
    fs.writeFileSync(pdfPath, pdf);
    console.log("PDF salvo em:", pdfPath);

    abrirPDF(pdfPath);
  }
}

// Função principal do plugin Raycast
export default async () => {
  await closeMainWindow();
  await showLoadingHUD("Processando...");
  const frontmostApp = await getFrontmostApplication();

  try {
    if (frontmostApp.bundleId === finderBundleId) {
      const filePath = await copyFinderPath();
      if (!filePath) throw new Error("Nenhum arquivo selecionado no Finder!");

      // Verifica se é ZIP pelo conteúdo ou extensão
      const ext = filePath.split(".").pop()?.toLowerCase();
      const buffer = fs.readFileSync(filePath);
      const isZip = ext === "zip" || (buffer[0] === 0x50 && buffer[1] === 0x4b); // PK magic bytes

      if (isZip) {
        await processZip(filePath);
      } else {
        await processFile(filePath);
      }
    } else {
      throw new Error("Você não selecionou nenhum arquivo!");
    }
  } catch (err) {
    showHUD(err instanceof Error ? err.message : String(err));
  }
};
