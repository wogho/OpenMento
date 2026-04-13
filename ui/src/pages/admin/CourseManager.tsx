import { useState, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { Bot, BookOpen, GraduationCap, Plus } from 'lucide-react';

interface Course {
  id: string;
  name: string;
  subject: string;
  isActive: boolean;
}

export default function CourseManager() {
  useAuth();
  const [courses, setCourses] = useState<Course[]>([]);
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');

  useEffect(() => {
    fetchCourses();
  }, []);

  const fetchCourses = async () => {
    const res = await fetch('/api/admin/courses', {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
    });
    const data = await res.json();
    if (res.ok) setCourses(data);
  };

  const createCourse = async () => {
    if (!name || !subject) return;
    const res = await fetch('/api/admin/courses', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        Authorization: `Bearer ${localStorage.getItem('token')}` 
      },
      body: JSON.stringify({ name, subject }),
    });
    if (res.ok) {
      setName('');
      setSubject('');
      fetchCourses();
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-6 flex items-center gap-2">
        <BookOpen className="text-indigo-600" />
        담당 과정 관리 (Course Hub)
      </h1>

      <div className="bg-white p-6 rounded-xl shadow-sm mb-6 border">
        <h2 className="text-lg font-semibold mb-4 text-gray-800">새 과정 개설</h2>
        <div className="flex gap-4 items-end">
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-1">과정명</label>
            <input 
              type="text" 
              className="w-full p-2 border rounded-md" 
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="예: 2024년 1학기 자바 전문가"
            />
          </div>
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-1">과목분야</label>
            <input 
              type="text" 
              className="w-full p-2 border rounded-md"
              value={subject}
              onChange={e => setSubject(e.target.value)}
              placeholder="예: java, python"
            />
          </div>
          <button 
            onClick={createCourse}
            className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-md hover:bg-indigo-700 h-[42px]"
          >
            <Plus size={18} /> 개설
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
        <div className="p-4 bg-gray-50 border-b flex justify-between items-center">
          <h2 className="font-semibold text-gray-800">운영 중인 과정 목록</h2>
        </div>
        <ul className="divide-y text-sm">
          {courses.map(course => (
            <li key={course.id} className="p-4 hover:bg-gray-50 transition-colors flex items-center justify-between">
              <div>
                <p className="font-medium text-base text-gray-900">{course.name}</p>
                <div className="text-gray-500 mt-1 flex gap-4">
                  <span className="flex items-center gap-1"><BookOpen size={14} /> {course.subject}</span>
                  <span className="flex items-center gap-1">
                    <span className={`w-2 h-2 rounded-full ${course.isActive ? 'bg-green-500' : 'bg-gray-400'}`}></span>
                    {course.isActive ? '활성' : '종료'}
                  </span>
                </div>
              </div>
              <div className="flex gap-2">
                <button className="px-3 py-1.5 border rounded-md text-gray-600 hover:bg-gray-100 flex items-center gap-1">
                  <GraduationCap size={14} /> 수강생 목록
                </button>
                <button className="px-3 py-1.5 border rounded-md text-gray-600 hover:bg-gray-100 flex items-center gap-1">
                  <Bot size={14} /> 에이전트 연동
                </button>
              </div>
            </li>
          ))}
          {courses.length === 0 && (
            <li className="p-8 text-center text-gray-500">생성된 과정이 없습니다.</li>
          )}
        </ul>
      </div>
    </div>
  );
}
