import { Document, Page, Text, View, StyleSheet, Link } from "@react-pdf/renderer"
import { getLinkedInProfile } from "@/lib/profile-utils"
import type { ResumeData } from "../parse-resume"
import { flattenSkills } from "../parse-resume"

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontFamily: "Helvetica",
    fontSize: 10,
    color: "#0f172a",
    backgroundColor: "#ffffff",
  },
  header: {
    marginBottom: 20,
    paddingBottom: 16,
    borderBottomWidth: 2,
    borderBottomColor: "#3b82f6",
  },
  name: {
    fontSize: 28,
    fontFamily: "Helvetica-Bold",
    color: "#0f172a",
    marginBottom: 4,
  },
  jobTitle: {
    fontSize: 14,
    color: "#3b82f6",
    fontFamily: "Helvetica",
    marginBottom: 10,
  },
  contactRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginBottom: 12,
  },
  contactItem: {
    fontSize: 9,
    color: "#475569",
  },
  contactItemGroup: {
    flexDirection: "row",
    alignItems: "center",
  },
  contactSeparator: {
    marginHorizontal: 6,
    color: "#94a3b8",
  },
  section: {
    marginBottom: 4,
  },
  sectionTitle: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase",
    letterSpacing: 1.5,
    color: "#3b82f6",
    marginBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
  },
  summaryText: {
    fontSize: 10,
    lineHeight: 1.6,
    color: "#334155",
  },
  skillsContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginBottom: 6,
  },
  skillBadge: {
    backgroundColor: "#eff6ff",
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 12,
    fontSize: 9,
    color: "#1d4ed8",
  },
  experienceItem: {
    marginTop: 12,
  },
  experienceHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 4,
  },
  experienceRole: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    color: "#0f172a",
  },
  experienceDuration: {
    fontSize: 9,
    color: "#64748b",
    backgroundColor: "#f1f5f9",
    paddingVertical: 2,
    paddingHorizontal: 4,
    borderRadius: 4,
  },
  experienceCompany: {
    fontSize: 10,
    color: "#3b82f6",
    marginBottom: 6,
  },
  bulletList: {
    marginLeft: 4,
  },
  bulletItem: {
    flexDirection: "row",
    marginBottom: 4,
  },
  bullet: {
    width: 12,
    fontSize: 10,
    color: "#3b82f6",
  },
  bulletText: {
    flex: 1,
    fontSize: 9,
    lineHeight: 1.5,
    color: "#334155",
  },
  educationItem: {
    marginBottom: 8,
  },
  educationHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  educationDegree: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    color: "#0f172a",
  },
  educationSchool: {
    fontSize: 9,
    color: "#64748b",
  },
  educationYear: {
    fontSize: 9,
    color: "#64748b",
  },
})

export const ModernTemplate = ({ data }: { data: ResumeData }) => {
  const { personalInfo, education, certifications, summary, skills, workexperience } = data
  const contactItems = [personalInfo.phone, personalInfo.email, personalInfo.location].filter(Boolean)
  const linkedInProfile = getLinkedInProfile(personalInfo.linkedin)

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.name}>{personalInfo.fullName}</Text>
          <Text style={styles.jobTitle}>{personalInfo.title}</Text>
          <View style={styles.contactRow}>
            {contactItems.map((item, index) => (
              <View key={index} style={styles.contactItemGroup}>
                <Text style={styles.contactItem}>{item}</Text>
                {index < contactItems.length - 1 && <Text style={styles.contactSeparator}>|</Text>}
              </View>
            ))}
            {linkedInProfile && (
              <View style={styles.contactItemGroup}>
                {contactItems.length > 0 && <Text style={styles.contactSeparator}>|</Text>}
                <Link src={linkedInProfile.href} style={styles.contactItem}>
                  {linkedInProfile.label}
                </Link>
              </View>
            )}
          </View>
        </View>

        {summary && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Summary</Text>
            <Text style={styles.summaryText}>{summary}</Text>
          </View>
        )}

        {skills.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Technical Skills</Text>
            <View style={styles.skillsContainer}>
              {flattenSkills(skills).map((skill, index) => (
                <Text key={index} style={styles.skillBadge}>{skill}</Text>
              ))}
            </View>
          </View>
        )}

        {workexperience.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Experience</Text>
            {workexperience.map((exp, index) => (
              <View key={index} style={index === 0 ? undefined : styles.experienceItem} wrap={true}>
                <View wrap={false}>
                  <View style={styles.experienceHeader}>
                    {exp.companyname && <Text style={styles.experienceRole}>{exp.companyname}</Text>}
                    {exp.duration && <Text style={styles.experienceDuration}>{exp.duration}</Text>}
                  </View>
                  <Text style={styles.experienceCompany}>{exp.role}</Text>
                </View>
                <View style={styles.bulletList}>
                  {exp.experience.map((bullet, bulletIndex) => (
                    <View key={bulletIndex} style={styles.bulletItem} wrap={false}>
                      <Text style={styles.bullet}>•</Text>
                      <Text style={styles.bulletText}>{bullet}</Text>
                    </View>
                  ))}
                </View>
              </View>
            ))}
          </View>
        )}
        
        {education.length > 0 && (
          <View style={styles.section} wrap={false}>
          <Text style={styles.sectionTitle}>Education</Text>
          {education.map((edu, index) => (
            <View key={index} style={styles.educationItem}>
              <View style={styles.educationHeader}>
                <View>
                  <Text style={styles.educationDegree}>{edu.degree}</Text>
                  <Text style={styles.educationSchool}>{edu.school}</Text>
                </View>
                <Text style={styles.educationYear}>{edu.year}</Text>
              </View>
            </View>
          ))}
        </View>
        )}

        {certifications.length > 0 && (
          <View style={styles.section} wrap={false}>
            <Text style={styles.sectionTitle}>Certifications</Text>
            {certifications.map((certification, index) => (
              <View key={index} style={styles.educationItem}>
                <View style={styles.educationHeader}>
                  <View><Text style={styles.educationDegree}>{certification.name}</Text><Text style={styles.educationSchool}>{certification.issuer}</Text></View>
                  <Text style={styles.educationYear}>{certification.year}</Text>
                </View>
              </View>
            ))}
          </View>
        )}
      </Page>
    </Document>
  )
}
