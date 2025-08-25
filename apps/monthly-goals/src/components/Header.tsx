import { Link } from '@tanstack/react-router'

export default function Header() {
  return (
    <header className="p-4 flex gap-2 bg-white text-black justify-between border-b">
      <nav className="flex flex-row items-center">
        <div className="px-2 font-bold text-lg">
          <Link to="/">📊 Monthly Goals</Link>
        </div>
      </nav>
    </header>
  )
}
