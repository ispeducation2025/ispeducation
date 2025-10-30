import React, { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Menu, X } from "lucide-react";

export default function PromoterSidebar() {
  const location = useLocation();
  const [isOpen, setIsOpen] = useState(false);

  const menuItems = [
    { name: "Dashboard", path: "/promoter-dashboard" },
    { name: "Students", path: "/promoter-students" },
    { name: "Referrals", path: "/promoter-referrals" },
    { name: "Earnings", path: "/promoter-earnings" },
    { name: "Profile", path: "/promoter-profile" },
  ];

  return (
    <>
      {/* Top Mobile Header */}
      <div className="md:hidden flex items-center justify-between bg-cyan-700 text-white px-4 py-3 shadow-md">
        <h2 className="font-semibold text-lg">Promoter Panel</h2>
        <button onClick={() => setIsOpen(!isOpen)}>
          {isOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      {/* Sidebar */}
      <div
        className={`fixed md:static top-0 left-0 h-full bg-cyan-800 text-white transition-transform duration-300 z-40 w-64 p-5 ${
          isOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        }`}
      >
        <h1 className="text-2xl font-bold mb-6 hidden md:block">Promoter</h1>
        <ul className="space-y-4">
          {menuItems.map((item) => (
            <li key={item.path}>
              <Link
                to={item.path}
                className={`block px-3 py-2 rounded-lg text-base font-medium hover:bg-cyan-600 transition ${
                  location.pathname === item.path
                    ? "bg-cyan-600"
                    : "text-gray-200"
                }`}
                onClick={() => setIsOpen(false)} // close on mobile click
              >
                {item.name}
              </Link>
            </li>
          ))}
        </ul>
      </div>

      {/* Overlay for mobile */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 md:hidden z-30"
          onClick={() => setIsOpen(false)}
        ></div>
      )}
    </>
  );
}
