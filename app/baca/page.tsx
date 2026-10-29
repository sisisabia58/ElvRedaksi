import { getAppSql } from "@/src/auth/app-sql";
import { bioGrid } from "@/src/studio/bio";

export const dynamic = "force-dynamic";

const INSTRUCTION =
  "Klik postingan yang kamu lihat di Instagram untuk baca artikel lengkapnya di media aslinya.";

export default async function BacaPage() {
  const sql = await getAppSql();
  const grid = await bioGrid(sql);

  return (
    <div className="min-h-screen bg-[#f7f6f2] text-[#0d0d0d]">
      <div className="mx-auto w-full max-w-[640px]">
        <header className="flex flex-col items-center px-6 pb-6 pt-10 text-center">
          <div
            className="flex size-[72px] items-center justify-center rounded-full text-2xl font-semibold"
            style={{ backgroundColor: "#f6ee5f" }}
            aria-hidden
          >
            {grid.initial}
          </div>
          {grid.handle ? (
            <h1 className="mt-4 text-xl font-semibold tracking-tight">@{grid.handle}</h1>
          ) : null}
          <p className="mt-3 text-sm leading-relaxed">{INSTRUCTION}</p>
        </header>

        {grid.items.length === 0 ? (
          <p className="px-6 pb-8 text-center text-sm">Belum ada artikel.</p>
        ) : (
          <div className="grid grid-cols-3 gap-[3px]">
            {grid.items.map((item) => (
              <a
                key={item.code}
                href={`/s/${item.code}`}
                aria-label={`${item.title}, baca di ${item.sourceName}`}
                className="relative block aspect-[4/5] overflow-hidden bg-[#e7e3d6]"
              >
                {item.assetId ? (
                  <img
                    src={`/media/${item.assetId}`}
                    alt=""
                    className="size-full object-cover"
                  />
                ) : null}
                <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent px-2 pb-2 pt-6 text-xs font-medium text-white">
                  {item.sourceName}
                </span>
              </a>
            ))}
          </div>
        )}

        <footer className="space-y-2 px-6 py-8 text-center text-xs leading-relaxed">
          <p>
            {grid.handle
              ? `Konten di @${grid.handle} merangkum berita dari media lain dengan sudut pandang sendiri.`
              : "Konten ini merangkum berita dari media lain dengan sudut pandang sendiri."}
          </p>
          <p>Artikel lengkap dan liputan aslinya ada di situs media sumber.</p>
        </footer>
      </div>
    </div>
  );
}
