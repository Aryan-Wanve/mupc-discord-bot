import ExcelJS from "exceljs";
import fs from "fs";
import path from "path";

const studentDataDirectory = path.join(process.cwd(), "stud_data");

let studentNameLookupCache:
  | {
      fingerprint: string;
      byEnrollment: Map<string, string>;
    }
  | null = null;

const normalizeHeaderKey = (value: unknown) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

const getStudentDataFingerprint = (files: fs.Dirent[]) =>
  files
    .map((file) => {
      const fullPath = path.join(studentDataDirectory, file.name);
      const stats = fs.statSync(fullPath);
      return `${file.name}:${stats.mtimeMs}:${stats.size}`;
    })
    .sort()
    .join("|");

export const normalizeEnrollmentNo = (value: string) => value.trim().toUpperCase();

export const loadStudentNameLookup = async () => {
  if (!fs.existsSync(studentDataDirectory)) {
    return new Map<string, string>();
  }

  const files = fs
    .readdirSync(studentDataDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".xlsx"));
  const fingerprint = getStudentDataFingerprint(files);

  if (studentNameLookupCache?.fingerprint === fingerprint) {
    return studentNameLookupCache.byEnrollment;
  }

  const byEnrollment = new Map<string, string>();

  for (const file of files) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(path.join(studentDataDirectory, file.name));

    for (const worksheet of workbook.worksheets) {
      const headerRow = worksheet.getRow(1);
      const headerIndexByKey = new Map<string, number>();

      headerRow.eachCell((cell, columnNumber) => {
        headerIndexByKey.set(normalizeHeaderKey(cell.value), columnNumber);
      });

      const studentNameColumn = headerIndexByKey.get("studentname");
      const enrollmentColumn = headerIndexByKey.get("enrollmentno");

      if (!studentNameColumn || !enrollmentColumn) {
        continue;
      }

      worksheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) {
          return;
        }

        const enrollmentNo = normalizeEnrollmentNo(String(row.getCell(enrollmentColumn).value ?? ""));
        const studentName = String(row.getCell(studentNameColumn).value ?? "").trim();

        if (enrollmentNo && studentName && !byEnrollment.has(enrollmentNo)) {
          byEnrollment.set(enrollmentNo, studentName);
        }
      });
    }
  }

  studentNameLookupCache = { fingerprint, byEnrollment };
  return byEnrollment;
};

export const getStudentNameForEnrollment = (
  enrollmentNo: string,
  studentNamesByEnrollment: Map<string, string>
) => {
  if (!enrollmentNo || enrollmentNo === "Not registered") {
    return "-";
  }

  return studentNamesByEnrollment.get(normalizeEnrollmentNo(enrollmentNo)) ?? "Data not available";
};

export const isEnrollmentMatched = (
  enrollmentNo: string,
  studentNamesByEnrollment: Map<string, string>
) => {
  if (!enrollmentNo || enrollmentNo === "Not registered") {
    return false;
  }

  return studentNamesByEnrollment.has(normalizeEnrollmentNo(enrollmentNo));
};

