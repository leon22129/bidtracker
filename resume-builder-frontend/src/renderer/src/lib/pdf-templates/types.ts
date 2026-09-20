import type { ResumeData } from "../parse-resume"

export type TemplateId = "classic" | "modern" | "minimal" | "executive" | "academic" | "tech" | "elegant" | "bold" | "corporate"

export interface TemplateInfo {
  id: TemplateId
  name: string
  description: string
  previewColors: {
    primary: string
    secondary: string
    accent: string
  }
  previewImage: string
}

const templatePreview = (filename: string): string => `${import.meta.env.BASE_URL}templates/${filename}`

export const TEMPLATES: TemplateInfo[] = [
  {
    id: "classic",
    name: "Classic",
    description: "Traditional professional style with Times font",
    previewColors: {
      primary: "#00194b",
      secondary: "#2d3542",
      accent: "#d1d5db",
    },
    previewImage: templatePreview("classic-preview.png"),
  },
  {
    id: "modern",
    name: "Modern",
    description: "Clean, contemporary design with sans-serif fonts",
    previewColors: {
      primary: "#0f172a",
      secondary: "#475569",
      accent: "#3b82f6",
    },
    previewImage: templatePreview("modern-preview.png"),
  },
  {
    id: "minimal",
    name: "Minimal",
    description: "Simple and elegant with maximum whitespace",
    previewColors: {
      primary: "#171717",
      secondary: "#525252",
      accent: "#a3a3a3",
    },
    previewImage: templatePreview("minimal-preview.png"),
  },
  {
    id: "executive",
    name: "Executive",
    description: "Bold and authoritative for senior positions",
    previewColors: {
      primary: "#1e3a5f",
      secondary: "#374151",
      accent: "#b8860b",
    },
    previewImage: templatePreview("executive-preview.png"),
  },
  {
    id: "academic",
    name: "Academic",
    description: "Formal scholarly style with Times Roman",
    previewColors: {
      primary: "#1a1a1a",
      secondary: "#444444",
      accent: "#333333",
    },
    previewImage: templatePreview("academic-preview.png"),
  },
  {
    id: "tech",
    name: "Tech",
    description: "Developer-focused with teal accents",
    previewColors: {
      primary: "#0A0A0A",
      secondary: "#666666",
      accent: "#00D4AA",
    },
    previewImage: templatePreview("tech-preview.png"),
  },
  {
    id: "elegant",
    name: "Elegant",
    description: "Refined centered layout with gold accents",
    previewColors: {
      primary: "#2C2C2C",
      secondary: "#666666",
      accent: "#C9A962",
    },
    previewImage: templatePreview("elegant-preview.png"),
  },
  {
    id: "bold",
    name: "Bold",
    description: "Strong impactful design with dark header",
    previewColors: {
      primary: "#1A1A2E",
      secondary: "#666666",
      accent: "#E94560",
    },
    previewImage: templatePreview("bold-preview.png"),
  },
  {
    id: "corporate",
    name: "Corporate",
    description: "Professional business with navy blue",
    previewColors: {
      primary: "#003366",
      secondary: "#555555",
      accent: "#003366",
    },
    previewImage: templatePreview("corporate-preview.png"),
  },
]

export const DEFAULT_TEMPLATE: TemplateId = "classic"
