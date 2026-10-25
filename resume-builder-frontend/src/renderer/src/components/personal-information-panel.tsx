import { Briefcase, MapPin, UserRound } from "lucide-react";
import type { ReactNode } from "react";
import type { PersonalInfo } from "@/lib/parse-resume";

type Detail = readonly [label: string, value: string | undefined];

function DetailList({ items }: { items: Detail[] }) {
  return (
    <dl className="grid gap-x-5 md:grid-cols-3">
      {items.map(([label, value]) => {
        const href = !value?.trim() ? null
          : label === "Email" ? `mailto:${value}`
          : label === "Phone" ? `tel:${value}`
          : label === "LinkedIn" ? (/^https?:\/\//i.test(value) ? value : `https://${value}`)
          : null;
        return (
          <div key={label} className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] items-baseline gap-x-3 border-b border-border/40 py-0.5 md:block md:py-1">
            <dt className="text-xs font-medium leading-4 text-muted-foreground">{label}</dt>
            <dd className="min-w-0 break-words text-[13px] leading-[18px] text-foreground [overflow-wrap:anywhere] md:mt-1 md:text-sm md:leading-5">
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

function InfoSection({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold tracking-tight">
        <span className="shrink-0 text-primary" aria-hidden="true">{icon}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

export function PersonalInformationPanel({ personalInfo }: { personalInfo: PersonalInfo }) {
  return (
    <div className="space-y-2 md:space-y-4">
      <InfoSection
        title="Personal information"
        icon={<UserRound className="size-4" />}
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
      </InfoSection>
      <InfoSection title="Full address" icon={<MapPin className="size-4" />}>
        <DetailList items={[
          ["Street address", personalInfo.address1],
          ["City", personalInfo.city],
          ["State", personalInfo.state],
          ["ZIP code", personalInfo.zip],
          ["County", personalInfo.county],
          ["Country", personalInfo.country],
        ]} />
      </InfoSection>
      <InfoSection title="Demographics & work" icon={<Briefcase className="size-4" />}>
        <DetailList items={[
          ["Gender", personalInfo.gender],
          ["Hispanic / Latino", personalInfo.hispanicLatino],
          ["Race / ethnicity", personalInfo.ethnicity],
          ["US work status", personalInfo.usWorkStatus],
          ["US work authorization", personalInfo.legallyAuthorizedUs],
          ["Sponsorship required", personalInfo.requiresSponsorship],
        ]} />
      </InfoSection>
    </div>
  );
}
