"use client"

import { TEMPLATES, type TemplateId } from "@/lib/pdf-templates"
import { cn } from "@/lib/utils"
import { Check } from "lucide-react"

interface TemplateSelectorProps {
  value: TemplateId
  onChange: (value: TemplateId) => void
}

export function TemplateSelector({ value, onChange }: TemplateSelectorProps) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      {TEMPLATES.map((template) => (
        <button
          key={template.id}
          type="button"
          onClick={() => onChange(template.id)}
          className={cn(
            "relative rounded-lg border-2 p-2 text-left transition-all hover:border-primary/50",
            value === template.id
              ? "border-primary bg-primary/5"
              : "border-border bg-background"
          )}
        >
          {/* Selection indicator */}
          {value === template.id && (
            <div className="absolute top-2 right-2 h-5 w-5 rounded-full bg-primary flex items-center justify-center">
              <Check className="h-3 w-3 text-primary-foreground" />
            </div>
          )}

          {/* Template Preview */}
          <div className="aspect-[8.5/11] rounded border bg-white mb-2 overflow-hidden">
            <TemplatePreview template={template} />
          </div>

          {/* Template Info */}
          <div className="space-y-0.5">
            <p className="text-sm font-medium">{template.name}</p>
            <p className="text-xs text-muted-foreground line-clamp-2">
              {template.description}
            </p>
          </div>
        </button>
      ))}
    </div>
  )
}

function TemplatePreview({ template }: { template: (typeof TEMPLATES)[0] }) {
  return (
    <img
      src={template.previewImage}
      alt={`${template.name} template preview`}
      className="w-full h-full object-cover"
    />
  )
}
