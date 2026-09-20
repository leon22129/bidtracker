import { Document, Page, Text, View, StyleSheet, Link } from "@react-pdf/renderer"
import type { ResumeData } from "../parse-resume"
import { getLinkedInProfile } from "@/lib/profile-utils"

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontFamily: "Times-Roman",
    fontSize: 10,
    color: "#1a1a1a",
    backgroundColor: "#ffffff",
  },
  header: {
    marginBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#000000",
    paddingBottom: 12,
    alignItems: "center",
  },
  name: {
    fontSize: 26,
    fontFamily: "Times-Bold",
    color: "#00194b",
    marginBottom: 4,
  },
  jobTitle: {
    fontSize: 14,
    color: "#2d3542",
    marginBottom: 8,
    alignSelf: "center",
    width: "100%",
    textAlign: "center",
  },
  contactRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
  },
  contactGroup: {
    flexDirection: "row",
    alignItems: "center",
  },
  contactItem: {
    fontSize: 12,
    color: "#0d0d0e",
  },
  contactSeparator: {
    fontSize: 12,
    color: "#9ca3af",
    marginHorizontal: 6,
  },
  section: {
    marginBottom: 14,
  },
  sectionTitle: {
    fontSize: 16,
    fontFamily: "Times-Bold",
    letterSpacing: 1,
    borderBottomWidth: 1,
    borderBottomColor: "#d1d5db",
    paddingBottom: 4,
    marginBottom: 8,
    color: "#002060",
  },
  summaryText: {
    fontSize: 11,
    lineHeight: 1.5,
    color: "#2d3542",
  },
  skillsContainer: {
    gap: 4,
  },
  skillCategoryRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 3,
    paddingBottom: 3,
  },
  skillBullet: {
    width: 10,
    fontSize: 11,
    color: "#2d3542",
  },
  skillCategoryLabel: {
    fontSize: 12,
    fontFamily: "Times-Bold",
    color: "#002060",
    marginRight: 4,
  },
  skillCategoryItems: {
    flex: 1,
    fontSize: 11,
    // lineHeight: 1.4,
    color: "#2d3542",
  },
  experienceItem: {
    marginTop: 8,
  },
  experienceHeader: {
    marginBottom: 2,
  },
  experienceRole: {
    fontSize: 14,
    fontFamily: "Times-Bold",
    color: "#002060",
    marginBottom: 4,
  },
  experienceMeta: {
    fontSize: 12.5,
    fontFamily: "Times-Roman",
    color: "#2d3542",
    marginTop: 0,
    marginBottom: 4,
  },
  experienceCompany: {
    fontSize: 12.5,
    fontFamily: "Times-Bold",
    color: "#2d3542",
  },
  experienceDuration: {
    fontSize: 12.5,
    fontFamily: "Times-Roman",
    color: "#6b7280",
  },
  bulletList: {
    marginLeft: 8,
  },
  bulletItem: {
    flexDirection: "row",
    marginBottom: 3,
  },
  bullet: {
    width: 10,
    fontSize: 11,
    color: "#2d3542",
  },
  bulletText: {
    flex: 1,
    fontSize: 11,
    lineHeight: 1.4,
    color: "#2d3542",
  },
  educationHeader: {
    marginBottom: 2,
  },
  educationDegree: {
    fontSize: 11,
    fontFamily: "Times-Bold",
    color: "#2d3542",
  },
  educationSchool: {
    fontSize: 12.5,
    fontFamily: "Times-Bold",
    color: "#002060",
    marginBottom: 4,
  },
  educationYear: {
    fontSize: 11,
    marginTop: 4,
    color: "#6b7280",
  },
})

export const ClassicTemplate = ({ data }: { data: ResumeData }) => {
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
              <View key={index} style={styles.contactGroup}>
                <Text style={styles.contactItem}>{item}</Text>
                {(index < contactItems.length - 1 || linkedInProfile) && <Text style={styles.contactSeparator}>|</Text>}
              </View>
            ))}
            {linkedInProfile && (
              <Link src={linkedInProfile.href} style={styles.contactItem}>{linkedInProfile.label}</Link>
            )}
          </View>
        </View>

        {summary && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Professional Summary</Text>
            <Text style={styles.summaryText}>{summary}</Text>
          </View>
        )}

        {skills.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Technical Skills</Text>
            {skills.map((group, index) => (
              <View key={index} style={styles.skillCategoryRow}>
                <Text style={styles.skillCategoryItems} wrap={true}>
                  <Text style={styles.skillCategoryLabel}>{group.category}</Text>
                  {`: ${group.items.join(", ")}`}
                </Text>
                </View>
            ))}
          </View>
        )}

        {workexperience.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Professional Experience</Text>
            {workexperience.map((exp, index) => (
              <View key={index} style={index === 0 ? undefined : styles.experienceItem} wrap={true}>
                <View wrap={false}>
                  <View style={styles.experienceHeader}>
                    <Text style={styles.experienceRole}>{exp.role}</Text>
                    {(exp.companyname || exp.duration) && (
                      <Text style={styles.experienceMeta}>
                        {exp.companyname && <Text style={styles.experienceCompany}>{exp.companyname}</Text>}
                        {exp.companyname && exp.duration && " ("}
                        {exp.duration && <Text style={styles.experienceDuration}>{exp.duration}</Text>}
                        {exp.companyname && exp.duration && ")"}
                      </Text>
                    )}
                  </View>
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

        <View style={styles.section} wrap={false}>
          <Text style={styles.sectionTitle}>Education</Text>
          {education.map((edu, index) => (
            <View key={index} style={[index > 0 ? { marginTop: 8 } : {}]}>
              <Text style={styles.educationSchool}>{edu.school}</Text>
              <Text style={styles.educationDegree}>{edu.degree}</Text>
              <Text style={styles.educationYear}>{edu.year}</Text>
            </View>
          ))}
        </View>

        <View style={styles.section}>
          {certifications.length > 0 && (
            <View style={styles.section} wrap={true}>
              <Text style={styles.sectionTitle}>Certifications</Text>
              {certifications.map((certification, index) => (
                <View key={index} style={[index > 0 ? { marginTop: 8 } : {}]}>
                  <Text style={styles.educationSchool}>{certification.name}</Text>
                  <Text style={styles.educationDegree}>{certification.issuer}</Text>
                  <Text style={styles.educationYear}>{certification.year}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      </Page>
    </Document>
  )
}
