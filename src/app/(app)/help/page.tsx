import type { Metadata } from "next";
import Link from "next/link";
import { requireContext } from "@/lib/auth";
import { getRhythm } from "@/lib/admin/service";
import { getTeamLogin } from "@/lib/login/service";
import { mailConfigured } from "@/lib/mail";
import { WEEKLY_LIMITS } from "@/lib/weekly/rules";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "Как работать" };

// Дни недели в нужных падежах: «до понедельника 18:00», «во вторник»
const UNTIL = ["понедельника", "вторника", "среды", "четверга", "пятницы", "субботы", "воскресенья"];
const ON = ["в понедельник", "во вторник", "в среду", "в четверг", "в пятницу", "в субботу", "в воскресенье"];

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-[17px] font-semibold text-ink">{title}</h2>
      <div className="flex flex-col gap-2 text-[15px] leading-relaxed text-ink">{children}</div>
    </section>
  );
}

/**
 * Инструкция для команды на один экран (этап 7 ТЗ). Сроки и пороги берутся из настроек,
 * поэтому после смены ритма недели инструкция не врёт
 */
export default async function HelpPage() {
  await requireContext();
  const [rhythm, teamLogin] = await Promise.all([getRhythm(), getTeamLogin()]);
  const mail = mailConfigured();
  const until = `${UNTIL[rhythm.deadlineWeekday - 1] ?? "понедельника"} ${rhythm.deadlineTime}`;
  const meeting = ON[rhythm.meetingWeekday - 1] ?? "во вторник";

  return (
    <>
      <PageHeader
        title="Как работать в Weekly"
        description="Weekly и задачи команды собраны здесь. Пока Bord остаётся главным, задачи из него приходят сюда сами раз в 5 минут."
      />
      <div className="grid gap-x-12 gap-y-8 lg:grid-cols-2">
        <Block title="Вход">
          <p>
            По личной ссылке: {mail ? "на экране входа введите рабочую почту, ссылка придёт письмом, или попросите её у владельца" : "её выдаёт владелец ресурса"}. Вход
            запомнится на устройстве на 30 дней, всё, что вы делаете, записывается на вас.
          </p>
          {teamLogin === "on" ? (
            <p>Пока идёт переходный период, работает и общий логин team: после входа выберите себя из списка, чужое имя не выбирайте.</p>
          ) : null}
          <p className="text-muted">Где открыт ваш вход и выход на всех устройствах: «Профиль и входы» в меню профиля.</p>
        </Block>

        <Block title="Ритм недели">
          <p>
            Weekly за прошедшую неделю сдаётся до {until} по Москве, встреча команды {meeting}. После встречи неделю закрывают, и записи правят только владелец и
            администраторы.
          </p>
          <p className="text-muted">После срока weekly всё равно можно сдать, он будет с отметкой «Сдан с опозданием».</p>
          <p className="text-muted">В отпуске или на больничном отметьте неделю в профиле, «Нет на неделе»: weekly за неё не ждём, на встрече видно, кто замещает.</p>
        </Block>

        <Block title="Сдать weekly">
          <p>
            На «Моей неделе» кнопка{" "}
            <Link href="/weekly/submit" className="font-medium text-blue-700 underline-offset-2 hover:underline">
              «Сдать weekly»
            </Link>
            . Три шага на одном экране:
          </p>
          <ol className="flex list-decimal flex-col gap-1 pl-5">
            <li>Обновить свои задачи: статус и «где сейчас».</li>
            <li>
              Главное за неделю одной фразой, до {WEEKLY_LIMITS.headline} знаков, и записи. В записи: что произошло (до {WEEKLY_LIMITS.what} знаков), влияние на
              бизнес, цифра или факт, что дальше и нужна ли помощь.
            </li>
            <li>Проверить и нажать «Сдать».</li>
          </ol>
          <p className="text-muted">Черновик сохраняется сам. Удалённую запись можно вернуть кнопкой «Отменить» в течение 5 секунд.</p>
        </Block>

        <Block title="Задачи">
          <ul className="flex list-disc flex-col gap-1 pl-5">
            <li>У задачи есть ответственный, срок и «где сейчас». Обновляйте «где сейчас» хотя бы раз в {rhythm.staleDays} дней, иначе задача получит метку «давно не обновлялась».</li>
            <li>Срок переносится только с причиной, число переносов видно всем.</li>
            <li>Закрыть задачу: «Выполнена» с итогом, «Не выполнена» или «Отменена» с причиной.</li>
            <li>Задачу себе ставит каждый. Коллеге лидер задачу предлагает, а подтверждают её владелец или администратор.</li>
            <li>Пока Bord главный, задачи с номерами до 1000 приходят из него. Поле, которое поменяли в Bord, заменяет значение здесь, в Bord ресурс ничего не пишет. Задачи, заведённые здесь, получают номера от 1001.</li>
          </ul>
          <p className="text-muted">Новая задача: клавиша N. Поиск задач: клавиша /.</p>
        </Block>

        <Block title="Встреча">
          <p>
            Ведущий открывает{" "}
            <Link href="/weekly/meeting" className="font-medium text-blue-700 underline-offset-2 hover:underline">
              режим встречи
            </Link>
            : записи недели крупно, риски и просьбы о помощи отдельно. Задачи разбираются на странице{" "}
            <Link href="/tasks/review" className="font-medium text-blue-700 underline-offset-2 hover:underline">
              «Разбор на встрече»
            </Link>
            .
          </p>
          <p className="text-muted">Заметки и разборы встреч остаются в Notion. Пока Bord главный, задачи со встречи заносят в Bord, сюда они придут сами.</p>
        </Block>

        <Block title="Кто что видит и правит">
          <ul className="flex list-disc flex-col gap-1 pl-5">
            <li>Weekly и задачи всей команды видят все.</li>
            <li>Свой weekly и свои задачи правит каждый, чужие только владелец и администраторы в режиме управления.</li>
            <li>Журнал всех изменений, отчёт CEO и настройки видят владелец и администраторы.</li>
          </ul>
          <p className="text-muted">Таблица для просмотра «Weekly: все задачи ресурса» обновляется сама. Ручные правки в ней ночная сверка возвращает обратно.</p>
        </Block>
      </div>
    </>
  );
}
