export function DataTable({
  columns,
  rows,
}: {
  columns: string[];
  rows: Array<Array<React.ReactNode>>;
}) {
  return (
    <div className="hidden overflow-hidden border border-[#D6DCE0] bg-white md:block">
      <table className="w-full border-collapse text-left text-sm">
        <thead className="bg-[#E8E8E8] text-xs uppercase text-[#6B747B]">
          <tr>
            {columns.map((column) => (
              <th key={column} className="border-b border-[#D6DCE0] px-4 py-3 font-medium">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-b border-[#D6DCE0] last:border-b-0">
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="px-4 py-3 align-middle text-[#26323A]">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
