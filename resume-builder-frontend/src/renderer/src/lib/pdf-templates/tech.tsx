import { Document, Page, Text, View, StyleSheet, Link } from "@react-pdf/renderer"
import { getLinkedInProfile } from "@/lib/profile-utils"
import type { ResumeData } from "../parse-resume"
import { flattenSkills } from "../parse-resume"

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontFamily: "Helvetica",
    fontSize: 10,
    lineHeight: 1.4,
    backgroundColor: "#FFFFFF",
  },
  header: {
    marginBottom: 20,
    paddingBottom: 15,
    borderBottom: "2pt solid #006652",
  },
  name: {
    fontSize: 26,
    fontFamily: "Helvetica-Bold",
    color: "#0A0A0A",
    marginBottom: 20,
  },
  contactRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginBottom: 12,
  },
  contactItem: {
    fontSize: 12,
    color: "#006652",
    fontFamily: "Helvetica",
  },
  contactItemGroup: {
    flexDirection: "row",
    alignItems: "center",
  },
  contactSeparator: {
    marginHorizontal: 6,
    color: "#9ca3af",
  },
  section: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    color: "#0A0A0A",
    marginBottom: 10,
    textTransform: "uppercase",
    letterSpacing: 1.5,
    paddingBottom: 4,
    borderBottom: "1pt solid #E5E5E5",
  },
  summaryText: {
    fontSize: 10,
    color: "#333333",
    lineHeight: 1.6,
  },
  experienceItem: {
    marginBottom: 14,
    paddingLeft: 10,
    borderLeft: "2pt solid #006652",
  },
  experienceHeader: {
    marginBottom: 4,
  },
  jobTitle: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    color: "#0A0A0A",
  },
  companyDate: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 2,
  },
  company: {
    fontSize: 10,
    color: "#006652",
  },
  dateRange: {
    fontSize: 9,
    color: "#666666",
  },
  bulletItem: {
    flexDirection: "row",
    marginBottom: 3,
  },
  bullet: {
    width: 10,
    fontSize: 10,
    color: "#444444",
  },
  bulletPoint: {
    fontSize: 9,
    color: "#444444",
    paddingLeft: 8,
  },
  educationItem: {
    marginBottom: 10,
    paddingLeft: 10,
    borderLeft: "2pt solid #E5E5E5",
  },
  degree: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    color: "#0A0A0A",
  },
  institution: {
    fontSize: 9,
    color: "#666666",
    marginTop: 2,
  },
  skillsContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginBottom: 6,
  },
  skillItem: {
    fontSize: 9,
    color: "#0A0A0A",
    backgroundColor: "#E8FBF6",
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderRadius: 3,
    borderWidth: 0.5,
    borderStyle: "solid",
    borderColor: "#006652",
  },
})

export function TechTemplate({ data }: { data: ResumeData }) {
  const { personalInfo, education, certifications, summary, skills, workexperience } = data
  const linkedInProfile = getLinkedInProfile(personalInfo.linkedin)
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.name}>{personalInfo.fullName}</Text>
          <View style={styles.contactRow}>
            {[personalInfo.email, personalInfo.phone, personalInfo.location].filter(Boolean).map((item, index, items) => (
              <View key={index} style={styles.contactItemGroup}>
                <Text style={styles.contactItem}>{item}</Text>
                {(index < items.length - 1 || linkedInProfile) && <Text style={styles.contactSeparator}>|</Text>}
              </View>
            ))}
            {linkedInProfile && (
              <View style={styles.contactItemGroup}>
                <Link src={linkedInProfile.href} style={styles.contactItem}>{linkedInProfile.label}</Link>
              </View>
            )}
          </View>
        </View>

        {/* Summary */}
        {summary && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>About</Text>
            <Text style={styles.summaryText}>{summary}</Text>
          </View>
        )}

        {/* Skills */}
        {skills && skills.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Tech Stack</Text>
            <View style={styles.skillsContainer}>
              {flattenSkills(skills).map((skill, index) => (
                <Text key={index} style={styles.skillItem}>
                  {skill}
                </Text>
              ))}
            </View>
          </View>
        )}

        {/* Experience */}
        {workexperience && workexperience.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Experience</Text>
            {workexperience.map((exp, index) => (
              <View key={index} style={styles.experienceItem}>
                <View style={styles.experienceHeader} wrap={false}>
                  <Text style={styles.jobTitle}>{exp.role}</Text>
                  <View style={styles.companyDate}>
                    <Text style={styles.company}>{exp.companyname}</Text>
                    <Text style={styles.dateRange}>{exp.duration}</Text>
                  </View>
                </View>
                {exp.experience.map((highlight, hIndex) => (
                  <View key={hIndex} style={styles.bulletItem} wrap={false}>
                    <Text style={styles.bullet}>•</Text>
                    <Text style={styles.bulletPoint}>{highlight}</Text>
                  </View>
                ))}
              </View>
            ))}
          </View>
        )}

        {/* Education */}
        {education.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Education</Text>
            {education.map((edu, index) => (
              <View key={index} style={[styles.educationItem, index > 0 ? { marginTop: 8 } : {}]}>
                <Text style={styles.degree}>{edu.degree}</Text>
                <Text style={styles.institution}>
                  {edu.school} • {edu.year}
                </Text>
              </View>
            ))}
          </View>
        )}


        {certifications.length > 0 && (
          <View style={styles.section} wrap={false}>
            <Text style={styles.sectionTitle}>Certifications</Text>
            {certifications.map((certification, index) => (
              <View key={index} style={styles.educationItem}><Text style={styles.degree}>{certification.name}</Text><Text style={styles.institution}>{certification.issuer}{certification.year ? ` - ${certification.year}` : ""}</Text></View>
            ))}
          </View>
        )}
      </Page>
    </Document>
  )
}

export const techMeta = {
  id: "tech" as const,
  name: "Tech",
  description: "Clean developer-focused design with teal accents",
  preview: {
    headerColor: "#0A0A0A",
    accentColor: "#006652",
    bgColor: "#ffffff",
  },
}
