import { useQuery } from '@tanstack/react-query';
import { BookOpen } from 'lucide-react';

interface CourseItem {
  id: string;
  name: string;
  subject: string;
  instructorName: string | null;
  agentId: string | null;
  isActive: boolean;
}

export default function ChatSidebar({
  onSelectCourse,
  activeCourseId,
  isOpen = false,
  onClose: _onClose,
}: {
  onSelectCourse: (courseId: string, agentId: string, courseName: string, instructorName: string | null) => void;
  activeCourseId?: string;
  isOpen?: boolean;
  onClose?: () => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['studentCourses'],
    queryFn: async () => {
      const res = await fetch(`${import.meta.env.VITE_API_URL ?? '/api'}/student/courses`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('openmento_token')}` },
      });
      if (!res.ok) throw new Error('Failed to fetch courses');
      return res.json() as Promise<{ courses: CourseItem[] }>;
    },
  });

  const courses = data?.courses ?? [];

  return (
    <aside className={`w-[280px] shrink-0 border-r border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-900 flex flex-col h-full transform transition-transform duration-300 md:relative fixed z-50 shadow-2xl md:shadow-none ${isOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}>
      <div className="p-4 border-b border-gray-200 dark:border-slate-700 shrink-0">
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-200">
          <BookOpen size={16} className="text-blue-500" />
          수강 목록
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {isLoading ? (
          <div className="text-center text-xs text-gray-400 py-8">불러오는 중...</div>
        ) : courses.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 px-4 text-center gap-2">
            <BookOpen size={32} className="text-gray-300 dark:text-slate-600" />
            <p className="text-sm text-gray-400 dark:text-slate-500">수강 중인 과목이 없습니다.</p>
            <p className="text-xs text-gray-300 dark:text-slate-600">강사에게 과목 등록을 요청하세요.</p>
          </div>
        ) : (
          courses.map((course) => (
            <button
              key={course.id}
              disabled={!course.agentId}
              onClick={() => course.agentId && onSelectCourse(course.id, course.agentId, course.name, course.instructorName)}
              className={`w-full text-left p-3 rounded-lg flex flex-col gap-1 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                activeCourseId === course.id
                  ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-900 dark:text-blue-100'
                  : 'hover:bg-gray-200/50 dark:hover:bg-slate-800 text-gray-700 dark:text-gray-300'
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <BookOpen
                  size={14}
                  className={activeCourseId === course.id ? 'text-blue-600 shrink-0' : 'text-gray-400 shrink-0'}
                />
                <span className="font-semibold text-sm truncate">
                  {course.instructorName
                    ? `${course.instructorName} - ${course.name}`
                    : course.name}
                </span>
              </div>
              <p className="text-[11px] text-gray-400 dark:text-slate-500 pl-6 truncate">
                {course.subject}
                {!course.agentId && ' · 에이전트 미설정'}
              </p>
            </button>
          ))
        )}
      </div>
    </aside>
  );
}
