import { useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

const gerarDatas = () => {
  const datas = [];
  const start = new Date("2025-05-20");
  const end = new Date("2025-07-18");
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    datas.push(new Date(d));
  }
  return datas;
};

const tarefasPadrao = gerarDatas().map((data) => ({
  data: data.toISOString().slice(0, 10),
  materia: "",
  pratica: "",
  revisao: "",
  concluido: false
}));

const obterSemana = (data) => {
  const d = new Date(data);
  const firstDay = new Date(d.getFullYear(), 0, 1);
  const pastDaysOfYear = (d - firstDay) / 86400000;
  return Math.ceil((pastDaysOfYear + firstDay.getDay() + 1) / 7);
};

export default function CronogramaEstudos() {
  const [tarefas, setTarefas] = useState(tarefasPadrao);
  const [semanaSelecionada, setSemanaSelecionada] = useState("todas");

  const atualizarCampo = (index, campo, valor) => {
    const novasTarefas = [...tarefas];
    novasTarefas[index][campo] = valor;
    setTarefas(novasTarefas);
  };

  const marcarConcluido = (index) => {
    const novasTarefas = [...tarefas];
    novasTarefas[index].concluido = !novasTarefas[index].concluido;
    setTarefas(novasTarefas);
  };

  const semanasUnicas = [...new Set(tarefas.map((t) => obterSemana(t.data)))].sort((a, b) => a - b);

  const tarefasFiltradas = semanaSelecionada !== "todas"
    ? tarefas.filter((t) => obterSemana(t.data) === Number(semanaSelecionada))
    : tarefas;

  const progressoSemanal = semanasUnicas.map((semana) => {
    const tarefasSemana = tarefas.filter((t) => obterSemana(t.data) === semana);
    const concluidas = tarefasSemana.filter((t) => t.concluido).length;
    return { semana: `Semana ${semana}`, concluidas };
  });

  return (
    <div className="min-h-screen bg-gray-100 p-6">
      <h1 className="text-2xl font-bold mb-6 text-center">Cronograma de Estudos IFRN - Redes</h1>

      <div className="mb-6 text-center">
        <label htmlFor="semana" className="mr-2 font-medium">Filtrar por semana:</label>
        <select
          id="semana"
          value={semanaSelecionada}
          onChange={(e) => setSemanaSelecionada(e.target.value)}
          className="border border-gray-300 rounded px-3 py-2 bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="todas">Todas as semanas</option>
          {semanasUnicas.map((s) => (
            <option key={s} value={s}>{`Semana ${s}`}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {tarefasFiltradas.map((tarefa, index) => (
          <div
            key={`${tarefa.data}-${index}`}
            className={`p-4 border rounded-xl shadow-md transition-all ${
              tarefa.concluido ? "bg-green-100" : "bg-white"
            }`}
          >
            <h3 className="text-lg font-bold mb-2 text-blue-800">
              {new Date(tarefa.data).toLocaleDateString("pt-BR", {
                weekday: "long", year: "numeric", month: "long", day: "numeric"
              })}
            </h3>

            <label className="block font-medium">Matéria:</label>
            <input
              className="border rounded w-full p-2 mb-2"
              value={tarefa.materia}
              onChange={(e) => atualizarCampo(index, "materia", e.target.value)}
            />

            <label className="block font-medium">Prática:</label>
            <input
              className="border rounded w-full p-2 mb-2"
              value={tarefa.pratica}
              onChange={(e) => atualizarCampo(index, "pratica", e.target.value)}
            />

            <label className="block font-medium">Revisão:</label>
            <textarea
              className="border rounded w-full p-2 mb-2"
              value={tarefa.revisao}
              onChange={(e) => atualizarCampo(index, "revisao", e.target.value)}
            />

            <button
              className={`w-full py-2 font-semibold rounded ${
                tarefa.concluido ? "bg-green-600 text-white" : "bg-blue-600 text-white hover:bg-blue-700"
              }`}
              onClick={() => marcarConcluido(index)}
            >
              {tarefa.concluido ? "✅ Concluído" : "Marcar como concluído"}
            </button>
          </div>
        ))}
      </div>

      <div className="mt-10 bg-white rounded-xl p-6 shadow">
        <h2 className="text-xl font-semibold mb-4 text-center">Progresso Semanal</h2>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={progressoSemanal}>
            <XAxis dataKey="semana" />
            <YAxis />
            <Tooltip />
            <Bar dataKey="concluidas" fill="#4F46E5" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
