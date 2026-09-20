import { Document, Page, Text, View, StyleSheet, Link } from "@react-pdf/renderer"
import type { ResumeData } from "../parse-resume"
import { flattenSkills } from "../parse-resume"
import { getLinkedInProfile } from "@/lib/profile-utils"

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontFamily: "Helvetica",
    fontSize: 10,
    lineHeight: 1.4,
    backgroundColor: "#FFFFFF",
  },
  header: {
    margin: -40,
    marginBottom: 25,
    backgroundColor: "#1A1A2E",
    padding: 35,
    paddingTop: 40,
    paddingBottom: 30
  },
  name: {
    fontSize: 32,
    fontFamily: "Helvetica-Bold",
    color: "#FFFFFF",
    marginBottom: 28,
    textTransform: "uppercase",
    letterSpacing: 2,
  },
  titleUnderline: {
    width: 80,
    height: 4,
    backgroundColor: "#E94560",
    marginBottom: 12,
  },
  contactRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginBottom: 15,
  },
  contactItem: {
    fontSize: 9,
    color: "#CCCCCC",
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
    marginBottom: 18,
  },
  sectionTitle: {
    fontSize: 14,
    fontFamily: "Helvetica-Bold",
    color: "#1A1A2E",
    marginBottom: 12,
    textTransform: "uppercase",
    letterSpacing: 1,
    paddingBottom: 4,
    borderBottomWidth: 2,
    borderBottomStyle: "solid",
    borderBottomColor: "#E94560",
  },
  summaryText: {
    fontSize: 10,
    color: "#333333",
    lineHeight: 1.6,
  },
  experienceItem: {
    marginBottom: 14,
  },
  experienceHeader: {
    backgroundColor: "#F8F8F8",
    padding: 10,
    marginBottom: 8,
  },
  jobTitle: {
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    color: "#1A1A2E",
    textTransform: "uppercase",
  },
  companyDate: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 4,
  },
  company: {
    fontSize: 10,
    color: "#E94560",
    fontFamily: "Helvetica-Bold",
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
    marginBottom: 4,
    paddingLeft: 12,
  },
  educationItem: {
    marginBottom: 10,
    backgroundColor: "#F8F8F8",
    padding: 10,
  },
  degree: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    color: "#1A1A2E",
    textTransform: "uppercase",
  },
  institution: {
    fontSize: 9,
    color: "#666666",
    marginTop: 3,
  },
  skillsContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginBottom: 5,
  },
  skillItem: {
    fontSize: 9,
    color: "#FFFFFF",
    backgroundColor: "#1A1A2E",
    paddingVertical: 6,
    paddingHorizontal: 4,
    fontFamily: "Helvetica-Bold",
  },
})

export function BoldTemplate({ data }: { data: ResumeData }) {
  const { personalInfo, education, certifications, summary, skills, workexperience } = data
  const linkedInProfile = getLinkedInProfile(personalInfo.linkedin)
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.name}>{personalInfo.fullName}</Text>
          <View style={styles.contactRow}>
            <Text style={styles.contactItem}>{personalInfo.email}</Text>
            <Text style={styles.contactItem}>{personalInfo.phone}</Text>
            <Text style={styles.contactItem}>{personalInfo.location}</Text>
            {linkedInProfile && (
              <Link src={linkedInProfile.href} style={styles.contactItem}>{linkedInProfile.label}</Link>
            )}
          </View>
        </View>

        {/* Summary */}
        {summary && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Summary</Text>
            <Text style={styles.summaryText}>{summary}</Text>
          </View>
        )}

        {/* Skills */}
        {skills && skills.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Skills</Text>
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
                <View style={styles.experienceHeader}>
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
        {education && education.length > 0 && (
          <View style={styles.section}>
            {certifications.length > 0 && (
              <View style={styles.section} wrap={false}>
                <Text style={styles.sectionTitle}>Certifications</Text>
                {certifications.map((certification, index) => (
                  <View key={index} style={styles.educationItem}><Text style={styles.degree}>{certification.name}</Text><Text style={styles.institution}>{certification.issuer}{certification.year ? ` - ${certification.year}` : ""}</Text></View>
                ))}
              </View>
            )}
            <Text style={styles.sectionTitle}>Education</Text>
            {education.map((edu, index) => (
              <View key={index} style={[styles.educationItem, index > 0 ? { marginTop: 8 } : {}]}>
                <Text style={styles.degree}>{edu.degree}</Text>
                <Text style={styles.institution}>
                  {edu.school} | {edu.year}
                </Text>
              </View>
            ))}
          </View>
        )}
      </Page>
    </Document>
  )
}

export const boldMeta = {
  id: "bold" as const,
  name: "Bold",
  description: "Strong impactful design with dark header",
  preview: {
    headerColor: "#1A1A2E",
    accentColor: "#E94560",
    bgColor: "#ffffff",
  },
}
