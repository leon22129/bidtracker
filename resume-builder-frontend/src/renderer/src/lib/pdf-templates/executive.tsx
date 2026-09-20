import { Document, Page, Text, View, StyleSheet, Link } from "@react-pdf/renderer"
import { getLinkedInProfile } from "@/lib/profile-utils"
import type { ResumeData } from "../parse-resume"
import { flattenSkills } from "../parse-resume"

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontFamily: "Times-Roman",
    fontSize: 10,
    color: "#1f2937",
    backgroundColor: "#ffffff",
  },
  header: {
    marginBottom: 20,
    backgroundColor: "#1e3a5f",
    marginHorizontal: -40,
    marginTop: -40,
    paddingHorizontal: 40,
    paddingVertical: 24,
  },
  name: {
    fontSize: 26,
    fontFamily: "Times-Bold",
    color: "#ffffff",
    textTransform: "uppercase",
    letterSpacing: 2,
    marginBottom: 4,
  },
  jobTitle: {
    fontSize: 14,
    color: "#ffe6a7",
    marginBottom: 10,
  },
  contactRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginBottom: 16,
  },
  contactItem: {
    fontSize: 11,
    color: "#d1d5db",
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
    textTransform: "uppercase",
    letterSpacing: 1,
    color: "#1e3a5f",
    marginBottom: 10,
    paddingBottom: 4,
    borderBottomWidth: 2,
    borderBottomColor: "#b8860b",
  },
  summaryText: {
    fontSize: 10,
    lineHeight: 1.6,
    color: "#374151",
  },
  skillsContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginBottom: 8,
  },
  skillBadge: {
    backgroundColor: "#f3f4f6",
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 2,
    fontSize: 9,
    color: "#1e3a5f",
    borderLeftWidth: 2,
    borderLeftColor: "#b8860b",
  },
  skillItem: {
    marginRight: 6,
    marginBottom: 6,
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
    fontFamily: "Times-Bold",
    color: "#1e3a5f",
  },
  experienceDuration: {
    fontSize: 9,
    color: "#6b7280",
  },
  experienceCompany: {
    fontSize: 10,
    color: "#b8860b",
    fontStyle: "italic",
    marginBottom: 6,
  },
  bulletList: {
    marginLeft: 8,
  },
  bulletItem: {
    flexDirection: "row",
    marginBottom: 4,
  },
  bullet: {
    width: 12,
    fontSize: 10,
    color: "#b8860b",
  },
  bulletText: {
    flex: 1,
    fontSize: 9,
    lineHeight: 1.5,
    color: "#374151",
  },
  educationItem: {
    marginBottom: 10,
  },
  educationHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  educationDegree: {
    fontSize: 10,
    fontFamily: "Times-Bold",
    color: "#1e3a5f",
  },
  educationSchool: {
    fontSize: 9,
    color: "#6b7280",
    fontStyle: "italic",
  },
  educationYear: {
    fontSize: 9,
    color: "#6b7280",
  },
})

export const ExecutiveTemplate = ({ data }: { data: ResumeData }) => {
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
                <Link src={linkedInProfile.href} style={styles.contactItem}>{linkedInProfile.label}</Link>
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
                <View key={index} style={styles.skillItem} wrap={false}>
                  <Text style={styles.skillBadge}>{skill}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {workexperience.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Professional Experience</Text>
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
              <View key={index} style={styles.educationItem}><Text style={styles.educationDegree}>{certification.name}</Text><Text style={styles.educationSchool}>{certification.issuer}</Text><Text style={styles.educationYear}>{certification.year}</Text></View>
            ))}
          </View>
        )}
      </Page>
    </Document>
  )
}
