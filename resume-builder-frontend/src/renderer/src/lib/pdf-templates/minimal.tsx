import { Document, Page, Text, View, StyleSheet, Link } from "@react-pdf/renderer"
import { getLinkedInProfile } from "@/lib/profile-utils"
import type { ResumeData } from "../parse-resume"
import { flattenSkills } from "../parse-resume"

const styles = StyleSheet.create({
  page: {
    padding: 50,
    fontFamily: "Helvetica",
    fontSize: 10,
    color: "#171717",
    backgroundColor: "#ffffff",
  },
  header: {
    marginBottom: 30,
    textAlign: "center",
  },
  name: {
    fontSize: 22,
    fontFamily: "Helvetica",
    color: "#171717",
    letterSpacing: 3,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  jobTitle: {
    fontSize: 11,
    color: "#525252",
    letterSpacing: 1,
    marginBottom: 12,
  },
  contactRow: {
    flexDirection: "row",
    justifyContent: "center",
    flexWrap: "wrap",
    marginBottom: 16,
  },
  contactItem: {
    fontSize: 9,
    color: "#737373",
  },
  contactItemGroup: {
    flexDirection: "row",
    alignItems: "center",
  },
  contactSeparator: {
    marginHorizontal: 6,
    color: "#a3a3a3",
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 9,
    fontFamily: "Helvetica",
    textTransform: "uppercase",
    letterSpacing: 2,
    color: "#a3a3a3",
    marginBottom: 12,
  },
  summaryText: {
    fontSize: 10,
    lineHeight: 1.8,
    color: "#404040",
  },
  skillsContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginBottom: 8,
  },
  skillBadge: {
    fontSize: 9,
    color: "#525252",
  },
  skillItem: {
    marginRight: 10,
    marginBottom: 5,
  },
  experienceItem: {
    marginTop: 16,
  },
  experienceHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 4,
  },
  experienceRole: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    color: "#171717",
  },
  experienceDuration: {
    fontSize: 9,
    color: "#a3a3a3",
  },
  experienceCompany: {
    fontSize: 9,
    color: "#737373",
    marginBottom: 8,
  },
  bulletList: {
    marginLeft: 0,
  },
  bulletItem: {
    flexDirection: "row",
    marginBottom: 4,
  },
  bullet: {
    width: 8,
    fontSize: 10,
    color: "#d4d4d4",
  },
  bulletText: {
    flex: 1,
    fontSize: 9,
    lineHeight: 1.6,
    color: "#525252",
  },
  divider: {
    borderBottomWidth: 0.5,
    borderBottomColor: "#7e7e7e",
    marginVertical: 20,
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
    color: "#171717",
  },
  educationSchool: {
    fontSize: 9,
    color: "#737373",
  },
  educationYear: {
    fontSize: 9,
    color: "#a3a3a3",
  },
})

export const MinimalTemplate = ({ data }: { data: ResumeData }) => {
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
            <Text style={styles.sectionTitle}>Profile</Text>
            <Text style={styles.summaryText}>{summary}</Text>
          </View>
        )}

        <View style={styles.divider} />

        {skills.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Expertise</Text>
            <View style={styles.skillsContainer}>
              {flattenSkills(skills).map((skill, index, flatSkills) => (
                <View key={index} style={styles.skillItem} wrap={false}>
                  <Text style={styles.skillBadge}>
                    {skill}{index < flatSkills.length - 1 ? "," : ""}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}

        <View style={styles.divider} />

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
                      <Text style={styles.bullet}>-</Text>
                      <Text style={styles.bulletText}>{bullet}</Text>
                    </View>
                  ))}
                </View>
              </View>
            ))}
          </View>
        )}

        <View style={styles.divider} />

        
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
