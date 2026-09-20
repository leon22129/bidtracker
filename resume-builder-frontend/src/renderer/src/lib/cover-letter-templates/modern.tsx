import { Document, Page, Text, View, StyleSheet, Link } from "@react-pdf/renderer"
import type { CoverLetterData } from "./types"
import { getLinkedInProfile } from "@/lib/profile-utils"

const ACCENT = "#3b82f6"

const styles = StyleSheet.create({
  page: {
    paddingHorizontal: 56,
    paddingVertical: 52,
    fontFamily: "Helvetica",
    fontSize: 11,
    color: "#0f172a",
    backgroundColor: "#ffffff",
  },
  accentBar: {
    height: 4,
    backgroundColor: ACCENT,
    marginBottom: 18,
  },
  name: {
    fontSize: 22,
    fontFamily: "Helvetica-Bold",
    color: "#0f172a",
    marginBottom: 3,
  },
  jobTitle: {
    fontSize: 12,
    color: "#475569",
    marginBottom: 6,
  },
  contactRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 28,
  },
  contactItem: {
    fontSize: 9.5,
    color: "#64748b",
  },
  date: {
    fontSize: 11,
    color: "#475569",
    marginBottom: 20,
  },
  paragraph: {
    fontSize: 11,
    lineHeight: 1.7,
    color: "#1e293b",
    marginBottom: 14,
  },
  signOff: {
    fontSize: 11,
    marginTop: 10,
    fontFamily: "Helvetica-Bold",
    color: "#0f172a",
  },
})

function formatDate(): string {
  return new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  })
}

export function ModernCoverLetterTemplate({ data }: { data: CoverLetterData }) {
  const { personalInfo, text } = data
  const paragraphs = text.split(/\n\n+/).map((p) => p.trim()).filter(Boolean)
  const contacts = [personalInfo.phone, personalInfo.email, personalInfo.location].filter(Boolean)
  const linkedInProfile = getLinkedInProfile(personalInfo.linkedin)

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.accentBar} />
        {personalInfo.fullName ? (
          <Text style={styles.name}>{personalInfo.fullName}</Text>
        ) : null}
        {personalInfo.title ? (
          <Text style={styles.jobTitle}>{personalInfo.title}</Text>
        ) : null}
        {(contacts.length > 0 || linkedInProfile) ? (
          <View style={styles.contactRow}>
            {contacts.map((item, i) => (
              <Text key={i} style={styles.contactItem}>{item}</Text>
            ))}
            {linkedInProfile && (
              <Link src={linkedInProfile.href} style={styles.contactItem}>{linkedInProfile.label}</Link>
            )}
          </View>
        ) : null}
        <Text style={styles.date}>{formatDate()}</Text>
        {paragraphs.map((p, i) => (
          <Text key={i} style={styles.paragraph}>{p}</Text>
        ))}
        {personalInfo.fullName ? (
          <Text style={styles.signOff}>{personalInfo.fullName}</Text>
        ) : null}
      </Page>
    </Document>
  )
}
