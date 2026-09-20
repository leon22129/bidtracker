import { Document, Page, Text, View, StyleSheet, Link } from "@react-pdf/renderer"
import type { ResumeData } from "../parse-resume"
import { flattenSkills } from "../parse-resume"
import { getLinkedInProfile } from "@/lib/profile-utils"

const styles = StyleSheet.create({
  page: {
    padding: 45,
    fontFamily: "Helvetica",
    fontSize: 10,
    lineHeight: 1.4,
    backgroundColor: "#FFFFFF",
  },
  header: {
    marginBottom: 20,
    borderBottom: "1pt solid #003366",
    paddingBottom: 15,
  },
  headerTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
  },
  name: {
    fontSize: 24,
    fontFamily: "Helvetica-Bold",
    color: "#003366",
  },
  contactColumn: {
    alignItems: "flex-end",
  },
  contactItem: {
    fontSize: 9,
    color: "#555555",
    marginBottom: 2,
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
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
  },
  sectionIcon: {
    width: 18,
    height: 18,
    backgroundColor: "#003366",
    marginRight: 8,
  },
  sectionTitle: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    color: "#003366",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  summaryText: {
    fontSize: 10,
    color: "#333333",
    lineHeight: 1.6,
    paddingLeft: 26,
  },
  experienceItem: {
    marginBottom: 12,
    paddingLeft: 26,
  },
  experienceHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  jobTitle: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    color: "#1a1a1a",
  },
  dateRange: {
    fontSize: 9,
    color: "#003366",
    fontFamily: "Helvetica-Bold",
  },
  company: {
    fontSize: 10,
    color: "#555555",
    marginBottom: 4,
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
    marginBottom: 3,
    paddingLeft: 10,
  },
  educationItem: {
    marginBottom: 8,
    paddingLeft: 26,
  },
  educationHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  degree: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    color: "#1a1a1a",
  },
  institution: {
    fontSize: 9,
    color: "#555555",
    marginTop: 2,
  },
  skillsContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginBottom: 6,
    paddingLeft: 26,
  },
  skillItem: {
    fontSize: 9,
    color: "#003366",
    backgroundColor: "#E8EEF4",
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderRadius: 2,
  },
})

export function CorporateTemplate({ data }: { data: ResumeData }) {
  const { personalInfo, education, certifications, summary, skills, workexperience } = data
  const linkedInProfile = getLinkedInProfile(personalInfo.linkedin)
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerTop}>
            <Text style={styles.name}>{personalInfo.fullName}</Text>
            <View style={styles.contactColumn}>
              <Text style={styles.contactItem}>{personalInfo.email}</Text>
              <Text style={styles.contactItem}>{personalInfo.phone}</Text>
              <Text style={styles.contactItem}>{personalInfo.location}</Text>
              {linkedInProfile && (
                <Link src={linkedInProfile.href} style={styles.contactItem}>{linkedInProfile.label}</Link>
              )}
            </View>
          </View>
        </View>

        {/* Summary */}
        {summary && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionIcon} />
              <Text style={styles.sectionTitle}>Summary</Text>
            </View>
            <Text style={styles.summaryText}>{summary}</Text>
          </View>
        )}

        {/* Skills */}
        {skills && skills.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionIcon} />
              <Text style={styles.sectionTitle}>Technical Skills</Text>
            </View>
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
            <View style={styles.sectionHeader}>
              <View style={styles.sectionIcon} />
              <Text style={styles.sectionTitle}>Professional Experience</Text>
            </View>
            {workexperience.map((exp, index) => (
              <View key={index} style={styles.experienceItem}>
                <View style={styles.experienceHeader}>
                  <Text style={styles.jobTitle}>{exp.role}</Text>
                  <Text style={styles.dateRange}>{exp.duration}</Text>
                </View>
                <Text style={styles.company}>{exp.companyname}</Text>
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
        {education.length > 0 || certifications.length > 0 ? (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionIcon} />
              <Text style={styles.sectionTitle}>Education</Text>
            </View>
            {certifications.length > 0 && (
              <View style={styles.section} wrap={false}>
                <Text style={styles.sectionTitle}>Certifications</Text>
                {certifications.map((certification, index) => (
                  <View key={index} style={styles.educationItem}><View style={styles.educationHeader}><View><Text style={styles.degree}>{certification.name}</Text><Text style={styles.institution}>{certification.issuer}</Text></View><Text style={styles.institution}>{certification.year}</Text></View></View>
                ))}
              </View>
            )}
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
        ) : null}

      </Page>
    </Document>
  )
}

export const corporateMeta = {
  id: "corporate" as const,
  name: "Corporate",
  description: "Professional business style with navy blue accents",
  preview: {
    headerColor: "#003366",
    accentColor: "#003366",
    bgColor: "#ffffff",
  },
}
