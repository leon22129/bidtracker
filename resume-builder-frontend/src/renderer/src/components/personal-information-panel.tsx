import { Briefcase, MapPin, UserRound } from "lucide-react";
import type { PersonalInfo } from "@/lib/parse-resume";
import { DashboardSection } from "@/components/dashboard-section";

type Detail = readonly [label: string, value: string | undefined];

function DetailList({ items }: { items: Detail[] }) {
  return (
    <dl className="grid gap-x-8 sm:grid-cols-2 xl:grid-cols-3">
      {items.map(([label, value]) => {
        const href = !value?.trim() ? null
          : label === "Email" ? `mailto:${value}`
          : label === "Phone" ? `tel:${value}`
          : label === "LinkedIn" ? (/^https?:\/\//i.test(value) ? value : `https://${value}`)
          : null;
        return (
          <div key={label} className="min-w-0 border-b border-border/60 py-4">
            <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
            <dd className="mt-1.5 break-words text-sm leading-6 text-foreground [overflow-wrap:anywhere]">
              {href ? (
                <a
                  href={href}
                  className="rounded-sm hover:text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                  {...(label === "LinkedIn" ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                >
                  {value}
                </a>
              ) : value?.trim() || "Not provided"}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

export function PersonalInformationPanel({ personalInfo }: { personalInfo: PersonalInfo }) {
  return (
    <div>
      <DashboardSection
        title="Personal information"
        description="The profile details used in your resume and application autofill."
        icon={<UserRound className="size-5" />}
        className="pt-0 sm:pt-0"
      >
        <DetailList items={[
          ["Full name", personalInfo.fullName],
          ["First name", personalInfo.firstName],
          ["Middle name", personalInfo.middleName],
          ["Last name", personalInfo.lastName],
          ["Email", personalInfo.email],
          ["Phone", personalInfo.phone],
          ["LinkedIn", personalInfo.linkedin],
        ]} />
      </DashboardSection>
      <DashboardSection title="Full address" icon={<MapPin className="size-5" />}>
        <DetailList items={[
          ["Street address", personalInfo.address1],
          ["City", personalInfo.city],
          ["State", personalInfo.state],
          ["ZIP code", personalInfo.zip],
          ["County", personalInfo.county],
          ["Country", personalInfo.country],
        ]} />
      </DashboardSection>
      <DashboardSection title="Demographics and work authorization" icon={<Briefcase className="size-5" />}>
        <DetailList items={[
          ["Gender", personalInfo.gender],
          ["Hispanic / Latino", personalInfo.hispanicLatino],
          ["Race / ethnicity", personalInfo.ethnicity],
          ["US work status", personalInfo.usWorkStatus],
          ["Legally authorized to work in the US", personalInfo.legallyAuthorizedUs],
          ["Requires sponsorship now or later", personalInfo.requiresSponsorship],
        ]} />
      </DashboardSection>
    </div>
  );
}
