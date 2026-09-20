import { Document, Page, Text, View, StyleSheet, Link } from "@react-pdf/renderer"
import type { CoverLetterData } from "./types"
import { getLinkedInProfile } from "@/lib/profile-utils"

const styles = StyleSheet.create({
  page: {
    paddingHorizontal: 64,
    paddingVertical: 60,
    fontFamily: "Helvetica",
    fontSize: 11,
    color: "#171717",
    backgroundColor: "#ffffff",
  },
  name: {
    fontSize: 18,
    fontFamily: "Helvetica-Bold",
    marginBottom: 2,
  },
  jobTitle: {
    fontSize: 11,
    color: "#525252",
    marginBottom: 5,
  },
  contactRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 32,
  },
  contactItem: {
    fontSize: 9.5,
    color: "#737373",
  },
  date: {
    fontSize: 11,
    color: "#525252",
    marginBottom: 22,
  },
  paragraph: {
    fontSize: 11,
    lineHeight: 1.7,
    marginBottom: 14,
  },
  signOff: {
    fontSize: 11,
    marginTop: 10,
    fontFamily: "Helvetica-Bold",
    color: "#171717",
  },
})

function formatDate(): string {
  return new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  })
}

export function MinimalCoverLetterTemplate({ data }: { data: CoverLetterData }) {
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
