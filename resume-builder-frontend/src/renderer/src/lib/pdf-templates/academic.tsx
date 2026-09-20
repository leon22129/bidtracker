import { Document, Page, Text, View, StyleSheet, Link } from "@react-pdf/renderer"
import type { ResumeData } from "../parse-resume"
import { flattenSkills } from "../parse-resume"
import { getLinkedInProfile } from "@/lib/profile-utils"

const styles = StyleSheet.create({
  page: {
    padding: 50,
    fontFamily: "Times-Roman",
    fontSize: 11,
    lineHeight: 1.5,
    backgroundColor: "#FFFFFF",
  },
  header: {
    marginBottom: 20,
    textAlign: "center",
    borderBottom: "1pt solid #333333",
    paddingBottom: 15,
  },
  name: {
    fontSize: 22,
    fontFamily: "Times-Bold",
    color: "#1a1a1a",
    marginBottom: 6,
    letterSpacing: 1,
  },
  contactInfo: {
    fontSize: 10,
    color: "#444444",
    marginTop: 4,
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
    fontSize: 12,
    fontFamily: "Times-Bold",
    color: "#1a1a1a",
    marginBottom: 10,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    borderBottom: "0.5pt solid #999999",
    paddingBottom: 3,
  },
  summaryText: {
    fontSize: 10,
    color: "#333333",
    textAlign: "justify",
  },
  experienceItem: {
    marginBottom: 12,
  },
  experienceHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 3,
  },
  jobTitle: {
    fontSize: 11,
    fontFamily: "Times-Bold",
    color: "#1a1a1a",
  },
  dateRange: {
    fontSize: 10,
    color: "#555555",
    fontFamily: "Times-Italic",
  },
  company: {
    fontSize: 10,
    color: "#444444",
    marginBottom: 4,
    fontFamily: "Times-Italic",
  },
  bulletPoint: {
    fontSize: 10,
    color: "#333333",
    marginLeft: 15,
  },
  bulletItem: {
    flexDirection: "row",
    marginBottom: 3,
  },
  bullet: {
    width: 10,
    fontSize: 10,
    color: "#333333",
  },
  educationItem: {
    marginBottom: 8,
  },
  educationHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  degree: {
    fontSize: 11,
    fontFamily: "Times-Bold",
    color: "#1a1a1a",
  },
  institution: {
    fontSize: 10,
    color: "#444444",
    fontFamily: "Times-Italic",
  },
  skillsContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginBottom: 6,
  },
  skillItem: {
    fontSize: 10,
    color: "#333333",
    backgroundColor: "#f5f5f5",
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderRadius: 2,
  },
})

export function AcademicTemplate({ data }: { data: ResumeData }) {
  const { personalInfo, education, certifications, summary, skills, workexperience } = data
  const linkedInProfile = getLinkedInProfile(personalInfo.linkedin)
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.name}>{personalInfo.fullName}</Text>
          <Text style={styles.contactInfo}>
            {personalInfo.email} | {personalInfo.phone} | {personalInfo.location}
          </Text>
          {linkedInProfile && (
            <Link src={linkedInProfile.href} style={styles.contactInfo}>{linkedInProfile.label}</Link>
          )}
        </View>

        {/* Summary */}
        {summary && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Professional Summary</Text>
            <Text style={styles.summaryText}>{summary}</Text>
          </View>
        )}

        {/* Skills */}
        {skills && skills.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Technical Skills</Text>
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
            <Text style={styles.sectionTitle}>Professional Experience</Text>
            {workexperience.map((exp, index) => (
              <View key={index} style={styles.experienceItem}>
                <View wrap={false}>
                  <View style={styles.experienceHeader}>
                    <Text style={styles.jobTitle}>{exp.role}</Text>
                    <Text style={styles.dateRange}>{exp.duration}</Text>
                  </View>
                  <Text style={styles.company}>{exp.companyname}</Text>
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
                <View style={styles.educationHeader}>
                  <Text style={styles.degree}>{edu.degree}</Text>
                  <Text style={styles.dateRange}>{edu.year}</Text>
                </View>
                <Text style={styles.institution}>{edu.school}</Text>
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

export const academicMeta = {
  id: "academic" as const,
  name: "Academic",
  description: "Formal scholarly style with Times Roman typography",
  preview: {
    headerColor: "#1a1a1a",
    accentColor: "#333333",
    bgColor: "#ffffff",
  },
}
