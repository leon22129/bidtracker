import { Document, Page, Text, View, StyleSheet, Link } from "@react-pdf/renderer"
import type { CoverLetterData } from "./types"
import { getLinkedInProfile } from "@/lib/profile-utils"

const styles = StyleSheet.create({
  page: {
    paddingHorizontal: 56,
    paddingVertical: 52,
    fontFamily: "Times-Roman",
    fontSize: 11,
    color: "#1a1a1a",
    backgroundColor: "#ffffff",
  },
  name: {
    fontSize: 22,
    fontFamily: "Times-Bold",
    color: "#00194b",
    textTransform: "uppercase",
    marginBottom: 3,
  },
  jobTitle: {
    fontSize: 12,
    color: "#2d3542",
    marginBottom: 6,
  },
  contactRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 4,
  },
  contactItem: {
    fontSize: 9.5,
    color: "#4b5563",
  },
  divider: {
    borderBottomWidth: 1,
    borderBottomColor: "#000000",
    marginBottom: 24,
    marginTop: 10,
  },
  date: {
    fontSize: 11,
    marginBottom: 20,
  },
  paragraph: {
    fontSize: 11,
    lineHeight: 1.65,
    marginBottom: 14,
  },
  signOff: {
    fontSize: 11,
    marginTop: 10,
    fontFamily: "Times-Bold",
  },
})

function formatDate(): string {
  return new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  })
}

export function ClassicCoverLetterTemplate({ data }: { data: CoverLetterData }) {
  const { personalInfo, text } = data
  const paragraphs = text.split(/\n\n+/).map((p) => p.trim()).filter(Boolean)
  const contacts = [personalInfo.phone, personalInfo.email, personalInfo.location].filter(Boolean)
  const linkedInProfile = getLinkedInProfile(personalInfo.linkedin)

  return (
    <Document>
      <Page size="A4" style={styles.page}>
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
        <View style={styles.divider} />
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
