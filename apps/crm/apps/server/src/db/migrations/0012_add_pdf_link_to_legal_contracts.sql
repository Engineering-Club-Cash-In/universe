-- Migration: Add pdfLink column to generated_legal_contracts table
ALTER TABLE "generated_legal_contracts" ADD COLUMN "pdf_link" text;
