export type Status =
  | "Open"
  | "Pending"
  | "Confirmed"
  | "Waitlisted"
  | "Present"
  | "Absent"
  | "Late"
  | "Closed";

export type Program = {
  id: string;
  name: string;
  ageRange: string;
  day: string;
  time: string;
  tuition: string;
  status: Status;
  description: string;
};

export type ClassSection = {
  id: string;
  programId: string;
  name: string;
  teacher: string;
  room: string;
  day: string;
  startTime: string;
  endTime: string;
  capacity: number;
  enrolled: number;
};

export type Student = {
  id: string;
  name: string;
  age: number;
  grade: string;
};

export const masjid = {
  name: "Masjid Assiddiq",
  slug: "assiddiq",
  email: "admin@assiddiq.example",
  address: "123 Masjid Road",
};

export const currentUser = {
  name: "Amr Soliman",
  email: "amr@example.com",
};

export const family = {
  id: "fam-1001",
  name: "Soliman Family",
  phone: "(555) 217-1144",
  students: [
    { id: "stu-1", name: "Yusuf Soliman", age: 9, grade: "Grade 4" },
    { id: "stu-2", name: "Maryam Soliman", age: 12, grade: "Grade 7" },
  ] satisfies Student[],
};

export const programs: Program[] = [
  {
    id: "quran-foundations",
    name: "Qur'an Foundations",
    ageRange: "Ages 6-9",
    day: "Saturday",
    time: "10:00 AM",
    tuition: "$45/mo",
    status: "Open",
    description: "Foundational recitation, short surahs, adab, and daily practice routines.",
  },
  {
    id: "arabic-level-1",
    name: "Arabic Level 1",
    ageRange: "Ages 8-12",
    day: "Tuesday",
    time: "5:30 PM",
    tuition: "$50/mo",
    status: "Open",
    description: "Letters, reading fluency, vocabulary, and simple sentence patterns.",
  },
  {
    id: "weekend-islamic-school",
    name: "Weekend Islamic School",
    ageRange: "Ages 6-14",
    day: "Sunday",
    time: "9:30 AM",
    tuition: "$60/mo",
    status: "Waitlisted",
    description: "A weekend program covering Qur'an, seerah, fiqh, akhlaq, and activities.",
  },
  {
    id: "youth-seerah-circle",
    name: "Youth Seerah Circle",
    ageRange: "Ages 13-17",
    day: "Friday",
    time: "7:15 PM",
    tuition: "Free",
    status: "Open",
    description: "Discussion-based youth circle connecting seerah lessons to modern life.",
  },
  {
    id: "sisters-tajweed",
    name: "Sisters Tajweed",
    ageRange: "Adults",
    day: "Wednesday",
    time: "6:30 PM",
    tuition: "$35/mo",
    status: "Open",
    description: "Tajweed review and guided recitation for sisters.",
  },
  {
    id: "ramadan-prep-workshop",
    name: "Ramadan Prep Workshop",
    ageRange: "Families",
    day: "Saturday",
    time: "2:00 PM",
    tuition: "$20",
    status: "Closed",
    description: "A short practical workshop for family Ramadan routines and Qur'an goals.",
  },
];

export const classes: ClassSection[] = [
  { id: "cls-1", programId: "quran-foundations", name: "Qur'an Foundations A", teacher: "Ust. Hana", room: "Room 1", day: "Sat", startTime: "10:00", endTime: "11:15", capacity: 16, enrolled: 14 },
  { id: "cls-2", programId: "arabic-level-1", name: "Arabic Level 1", teacher: "Br. Kareem", room: "Room 2", day: "Tue", startTime: "17:30", endTime: "18:30", capacity: 18, enrolled: 11 },
  { id: "cls-3", programId: "weekend-islamic-school", name: "Weekend School Lower", teacher: "Sr. Layla", room: "Hall A", day: "Sun", startTime: "09:30", endTime: "12:30", capacity: 24, enrolled: 24 },
  { id: "cls-4", programId: "weekend-islamic-school", name: "Weekend School Upper", teacher: "Sh. Musa", room: "Hall B", day: "Sun", startTime: "09:30", endTime: "12:30", capacity: 24, enrolled: 22 },
  { id: "cls-5", programId: "youth-seerah-circle", name: "Youth Seerah Circle", teacher: "Br. Sameer", room: "Library", day: "Fri", startTime: "19:15", endTime: "20:30", capacity: 30, enrolled: 19 },
  { id: "cls-6", programId: "sisters-tajweed", name: "Sisters Tajweed", teacher: "Sr. Nadia", room: "Room 3", day: "Wed", startTime: "18:30", endTime: "19:45", capacity: 20, enrolled: 13 },
  { id: "cls-7", programId: "ramadan-prep-workshop", name: "Ramadan Prep Workshop", teacher: "Imam Zayd", room: "Main Hall", day: "Sat", startTime: "14:00", endTime: "16:00", capacity: 80, enrolled: 68 },
];

export const sessions = [
  { id: "ses-1", classId: "cls-1", date: "2026-06-27", topic: "Surah Al-Fil review" },
  { id: "ses-2", classId: "cls-2", date: "2026-06-23", topic: "Letters and vowels" },
  { id: "ses-3", classId: "cls-5", date: "2026-06-26", topic: "Hijrah reflections" },
];

export const enrollments = [
  { id: "enr-1", studentId: "stu-1", classId: "cls-1", status: "Confirmed" as Status },
  { id: "enr-2", studentId: "stu-2", classId: "cls-2", status: "Confirmed" as Status },
  { id: "enr-3", studentId: "stu-2", classId: "cls-5", status: "Pending" as Status },
  { id: "enr-4", studentId: "stu-1", classId: "cls-3", status: "Waitlisted" as Status },
];

export const attendanceRecords = [
  { id: "att-1", sessionId: "ses-1", studentId: "stu-1", status: "Present" as Status },
  { id: "att-2", sessionId: "ses-2", studentId: "stu-2", status: "Late" as Status },
  { id: "att-3", sessionId: "ses-3", studentId: "stu-2", status: "Absent" as Status },
];

export const announcements = [
  { id: "ann-1", title: "Parent pickup reminder", date: "2026-06-21", body: "Please use the east entrance for weekend class pickup." },
  { id: "ann-2", title: "Summer schedule posted", date: "2026-06-19", body: "Updated class times are now available in the schedule page." },
  { id: "ann-3", title: "Teacher meeting", date: "2026-06-18", body: "Teachers will meet after Maghrib to review attendance procedures." },
];

export function getProgram(id: string) {
  return programs.find((program) => program.id === id) ?? programs[0];
}

export function getClass(id: string) {
  return classes.find((classSection) => classSection.id === id) ?? classes[0];
}

export function studentName(id: string) {
  return family.students.find((student) => student.id === id)?.name ?? "Student";
}

export function className(id: string) {
  return classes.find((classSection) => classSection.id === id)?.name ?? "Class";
}
