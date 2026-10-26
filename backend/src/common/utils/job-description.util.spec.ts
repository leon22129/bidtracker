import { formatJobDescription } from './job-description.util';

describe('saved job description formatting', () => {
  it('separates collapsed section headings and restores inline bullet lists', () => {
    const input = 'We build data platforms. Overview The role is remote. Responsibilities Key Responsibilities Define cloud standards. Essential Skills Experience with AWS. Benefits • Health insurance • Paid leave';
    const formatted = formatJobDescription(input);
    expect(formatted).toContain('Overview\n\nThe role is remote.');
    expect(formatted).toContain('Responsibilities\n\nKey Responsibilities\n\nDefine cloud standards.');
    expect(formatted).toContain('Essential Skills\n\nExperience with AWS.');
    expect(formatted).toContain('Benefits\n\n- Health insurance\n- Paid leave');
    expect(formatJobDescription('Work in our HQ Compensation and Benefits: The salary is $150,000.'))
      .toContain('Compensation and Benefits:\n\nThe salary is $150,000.');
  });

  it('keeps metadata, compensation, technical names, URLs, and qualifications intact', () => {
    const input = 'Job Information\nTitle: Senior Engineer\nSalary: $140,000k - $180,000K\n\nJob Description\nRequirements\n- 5+ years using Node.js, .NET, C++, and U.S. systems.\n- Details: https://careers.example.com/jobs/123\n\nExpected Rate (estimated)\nAnnual: $150,000\nHourly: $72.12';
    const formatted = formatJobDescription(input);
    expect(formatted).toContain('Job Information\nTitle: Senior Engineer\nSalary: $140,000k - $180,000K');
    expect(formatted).toContain('5+ years using Node.js, .NET, C++, and U.S. systems.');
    expect(formatted).toContain('https://careers.example.com/jobs/123');
    expect(formatted).toContain('Expected Rate (estimated)\nAnnual: $150,000\nHourly: $72.12');
  });

  it('wraps long paragraphs and remains stable when saved and downloaded again', () => {
    const paragraph = 'We develop reliable cloud services and work with colleagues across the organization. '.repeat(10);
    const input = `Job Description\n${paragraph}\n\nRequirements\n- ${'Experience building distributed systems and reliable services. '.repeat(4)}`;
    const formatted = formatJobDescription(input);
    expect(formatted.split('\n').every((line) => line.length <= 100)).toBe(true);
    expect(formatJobDescription(formatted)).toBe(formatted);
    expect(formatted.replace(/\s+/g, ' ')).toBe(input.replace(/\s+/g, ' ').trim());
  });

  it('preserves embedded paragraph headings and nested list indentation', () => {
    const formatted = formatJobDescription('Our products.Our culture:We work remotely.CanadaAbout the roleWe build platforms.\n- Data platforms\n  - SQL and Python');
    expect(formatted).toContain('Our culture:\n\nWe work remotely.Canada');
    expect(formatted).toContain('About the role\n\nWe build platforms.');
    expect(formatted).toContain('- Data platforms\n  - SQL and Python');
  });
});
