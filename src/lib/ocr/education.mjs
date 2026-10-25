// Transcript headers and result summaries are distinct from course/semester tables.
export function educationFacts(pages) {
  const facts = [],
    handledPages = new Set();
  let anchor = null;
  function add(page, line, fieldKey, label, value, warnings = []) {
    if (!value?.trim()) return;
    facts.push({
      sectionKey: "education",
      fieldKey,
      label,
      value: value.trim(),
      rawValue: value.trim(),
      pageNumber: page.pageNumber,
      sourceExcerpt: line.text,
      box: line.box || null,
      confidence: line.confidence ?? null,
      method: page.method,
      groupKey: "education:" + anchor,
      warnings,
    });
  }
  for (const page of pages) {
    const lines = page.lines || [];
    const isTranscript = lines
      .slice(0, 12)
      .some((l) =>
        /\b(?:final|academic|official)\s+transcript\b/i.test(l.text),
      );
    if (isTranscript) {
      anchor = page.pageNumber;
      handledPages.add(page.pageNumber);
      const header = lines.slice(
        0,
        Math.max(
          0,
          lines.findIndex((l) =>
            /\b(?:first|1st)\s+semester\b|course\s+(?:title|code)/i.test(
              l.text,
            ),
          ),
        ) || 12,
      );
      const degree = header.find((l) =>
        /^(?:degree\s+program(?:me)?|qualification(?:\s+title)?|degree\s+title)\b/i.test(
          l.text,
        ),
      );
      const title = degree?.text
        .replace(
          /^(?:degree\s+program(?:me)?|qualification(?:\s+title)?|degree\s+title)\s*[:：_–—.-]*\s*/i,
          "",
        )
        .split(/\s+duration\b/i)[0]
        .trim();
      const standalone = header.find((l) =>
        /^(?:Bachelor|Master|Doctor|Diploma|Associate)\b.{3,100}$/i.test(
          l.text,
        ),
      );
      const qualification = title || standalone?.text;
      const evidence = degree || standalone;
      if (qualification && evidence) {
        const period = header.find((l) =>
          /\b(?:academic\s+)?session\s*[:：_–—-]*\s*(?:19|20)\d{2}\s*[-–]\s*(?:19|20)\d{2}/i.test(
            l.text,
          ),
        );
        add(
          page,
          evidence,
          "qualification",
          "Qualification",
          qualification,
          period
            ? [
                "Attendance years are shown, but exact start/end dates are not stated.",
              ]
            : [],
        );
        const level = qualification.match(
          /^(Bachelor|Master|Doctor|Diploma|Associate)\b/i,
        )?.[1];
        if (level) add(page, evidence, "level", "Qualification level", level);
        const subject = qualification.match(/\bin\s+(.+)$/i)?.[1];
        if (subject) add(page, evidence, "subject", "Subject / major", subject);
      }
      const institute = header.find((l) =>
        /^(?:Institute|Institution(?:\s+name)?|College(?:\s+name)?)\s*[:：_–—.-]*\s+\S/i.test(
          l.text,
        ),
      );
      const university = header.find((l) =>
        /^(?:University\s+of\s+|.{2,60}\s+University\s*$)/i.test(l.text),
      );
      if (institute)
        add(
          page,
          institute,
          "institution",
          "Institution name",
          institute.text
            .replace(
              /^(?:Institute|Institution(?:\s+name)?|College(?:\s+name)?)\s*[:：_–—.-]*\s*/i,
              "",
            )
            .split(
              /\s+(?:Roll\s+No\.?|Registration\s+(?:No\.?|Number)|Exam\s+Type)\b/i,
            )[0],
        );
      else if (university)
        add(
          page,
          university,
          "institution",
          "Institution name",
          university.text,
        );
      // Only an overall/final summary can supply the qualification's grade.
      const overall = lines.filter(
        (l) =>
          /^(?:(?:final|overall|cumulative)\s+)?CGPA\s*[:：]?\s*\d/i.test(
            l.text,
          ) &&
          (/\b(?:total\s+credit|O\.?P\.?M|overall|final|cumulative)\b/i.test(
            l.text,
          ) ||
            /^(?:final|overall|cumulative)\s+CGPA/i.test(l.text)),
      );
      const values = [
        ...new Set(
          overall
            .map((l) => l.text.match(/CGPA\s*[:：]?\s*(\d+(?:\.\d+)?)/i)?.[1])
            .filter(Boolean),
        ),
      ];
      if (values.length === 1)
        add(page, overall[0], "grade", "Achieved grade", values[0]);
    } else if (anchor !== null) {
      // A grading appendix continues the immediately preceding transcript.
      const heading = lines
        .slice(0, 6)
        .find((l) => /grade\s+points/i.test(l.text));
      if (!heading) {
        anchor = null;
        continue;
      }
      handledPages.add(page.pageNumber);
      const scaleLines = lines
        .slice(0, 16)
        .filter((l) =>
          /\b(?:[A-F][+-]?|Above)\s+\d\.\d{1,2}\s*$/i.test(l.text),
        );
      const points = scaleLines
        .map((l) => Number(l.text.match(/(\d\.\d{1,2})\s*$/)?.[1]))
        .filter((n) => Number.isFinite(n));
      if (points.length >= 3) {
        const max = Math.max(...points),
          source = scaleLines.find(
            (l) => Number(l.text.match(/(\d\.\d{1,2})\s*$/)?.[1]) === max,
          );
        if (max > 0 && max <= 10) {
          add(
            page,
            { ...heading, text: heading.text + "\n" + source.text, box: null },
            "maximumGrade",
            "Maximum grade",
            String(max),
          );
          add(page, heading, "gradingSystem", "Grading system", "Grade points");
        }
      }
      const country = lines.find(
        (l) =>
          /(?:Department|University|College|Address)/i.test(l.text) &&
          /[-–—,]\s*([A-Za-z][A-Za-z ]{2,50})\s+Website:/i.test(l.text),
      );
      const countryName = country?.text.match(
        /[-–—,]\s*([A-Za-z][A-Za-z ]{2,50})\s+Website:/i,
      )?.[1];
      if (countryName)
        add(page, country, "country", "Institution country", countryName);
    }
  }
  return { facts, handledPages };
}
