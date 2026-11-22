# Развёртывание Hellar AI через GitHub

Репозиторий: https://github.com/AsalaMalekym/Hellar-AI

## Что будет создано

- Новый Worker `hellar-ai-cosmic` с интерфейсом сайта и API.
- Новый SQLite Durable Object `HellarDatabase` для аккаунтов, приглашений, сессий и истории.
- Закрытый R2 bucket `hellar-ai-cosmic-files` для сгенерированных картинок.

Старые Workers, D1, DNS и Hellar Voice не входят в эту конфигурацию. Старые аккаунты и история не импортируются автоматически. Не меняйте имя Worker, имя класса или `hellar-main-v1` после появления данных без плана миграции. База создаётся автоматически при первом запросе. D1 binding для этой версии не нужен.

## Настройка GitHub

Откройте Settings → Secrets and variables → Actions:
https://github.com/AsalaMalekym/Hellar-AI/settings/secrets/actions

Добавьте **Repository secrets**:

| Имя | Значение |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | ID нужного аккаунта Cloudflare |
| `CLOUDFLARE_API_TOKEN` | Account API token, ограниченный нужным аккаунтом: шаблон Edit Cloudflare Workers + Account / Workers R2 Storage / Edit |
| `HELLAR_SETUP_TOKEN` | Собственная случайная строка минимум 32 символа для первоначального создания владельца |
| `RESEND_API_KEY` | Ключ Resend с правом отправки с подтверждённого домена |
| `MAIL_FROM` | Отправитель на подтверждённом домене, например `Hellar AI <no-reply@hellarai.ru>` |
| `TURNSTILE_SITE_KEY` | Site key рабочего виджета Turnstile |
| `TURNSTILE_SECRET_KEY` | Secret key того же виджета |
| `OPENAI_API_KEY` | Ключ проекта с доступом к нужным моделям; можно добавить позднее |

Ключи не добавляются в файлы репозитория и не отправляются в чат. В Cloudflare токен создаётся в профиле/аккаунте → API Tokens. Для R2 нужно сначала активировать R2 в аккаунте. Условия, лимиты и возможную оплату показывает Cloudflare; workflow не меняет тариф аккаунта.

Адрес `workers.dev` теперь определяется автоматически через Cloudflare API. Для первого запуска переменная не нужна. Если требуется собственный уже подключённый домен, добавьте **Repository variable** (вкладка Variables):

| Имя | Значение |
| --- | --- |
| `HELLAR_APP_ORIGIN` | `https://hellar-ai-cosmic.<ваш-поддомен>.workers.dev` без завершающего `/` |

Поддомен Workers берётся в Cloudflare → Workers & Pages. Не используйте `hellarai.ru` до подключения этого домена к новому Worker: финальная проверка workflow обращается к указанному адресу.

## Подключение почты и капчи

Подробная инструкция: [EMAIL-CAPTCHA.md](EMAIL-CAPTCHA.md). Перед публикацией новой версии добавьте четыре настройки выше. Workflow остановится **до изменения работающего сайта**, если они отсутствуют. Push по-прежнему запускает только тесты.

## Первый запуск

1. Откройте GitHub → Actions → **Deploy Hellar to Cloudflare** → **Run workflow**, ветка `main`.
2. Дождитесь успешного завершения проверок и публикации. При ошибке шаг показывает, каких настроек не хватает. При отказе токена проверьте выбранный аккаунт и права, а не расширяйте доступ до всех аккаунтов.
3. Откройте ссылку `/setup` из Summary завершённого workflow. Введите значение `HELLAR_SETUP_TOKEN`, почту, имя и новый пароль владельца.
4. Войдите на `/login`. В разделе «Админ» создайте приглашения для пользователей.
5. После создания владельца удалите `SETUP_TOKEN` из Secrets Worker в Cloudflare и `HELLAR_SETUP_TOKEN` из GitHub. Даже до удаления повторное создание администратора запрещено транзакцией.
6. Проверьте один реальный ответ и одну картинку с вашим ключом. Автоматические тесты используют имитацию внешнего API, не тратят баланс и не подтверждают доступность моделей в вашем аккаунте.

Обновления публикуются той же кнопкой Run workflow. Push запускает проверки, но сам по себе не публикует сайт. После первого успешного запуска можно отдельно включить публикацию на push.

## Домен hellarai.ru

После проверки временного адреса добавьте **Custom Domain** `hellarai.ru` в настройках нового Worker. Если домен уже обслуживает другой сайт, это отдельное переключение рабочего адреса — сначала проверьте текущие маршруты и сохраните возможность отката. Обновите `HELLAR_APP_ORIGIN` на `https://hellarai.ru` и повторно запустите deploy. После смены адреса войдите заново. Конфигурация намеренно не содержит DNS-операций.

## Локальная проверка именно Cloudflare

Node.js 24:

```bash
npm ci
cp .dev.vars.example .dev.vars
# Задайте личный SETUP_TOKEN в .dev.vars; файл исключён из Git.
npm run dev:cloudflare
```

Откройте http://localhost:8787/setup. Удаление `.wrangler/state` уничтожает только локальные тестовые данные.

```bash
npm test
npm run build:cloudflare
npm run test:cloudflare
npx wrangler deploy --dry-run
```

## Границы версии

- Чат, приглашения, профиль, смена пароля, управление сессиями, квоты и генерация PNG перенесены. Авторизация — собственная, через почту и пароль; вход через ChatGPT не нужен. Google OAuth пока не реализован.
- Письма подтверждения почты и сброса пароля отправляются через Resend. Новые аккаунты создаются только после подтверждения почты и установки пароля. Приглашения сохранены. Капча обязательна в production. Загрузка аватаров в адаптере Cloudflare пока отключена.
- Модели задаются в `wrangler.jsonc`; разрешайте только те, к которым есть доступ в вашем OpenAI-проекте. Универсальной поддержки всех моделей нет.
- Эта версия использует один Durable Object для всего приложения: так сохраняются транзакции и общие квоты. Она рассчитана на закрытую бету, не на большое число одновременных пользователей.
- Данные находятся в новых ресурсах Cloudflare. Перенос содержимого прежних SQLite/D1 баз требует отдельной миграции. Не удаляйте рабочие ресурсы при обновлениях.
- Лимиты запросов не являются денежным потолком. Настройте бюджет у API-провайдера; R2, Workers и Durable Objects имеют собственные лимиты и условия оплаты.

Официальные документы:
- https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/
- https://developers.cloudflare.com/workers/static-assets/binding/
- https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/
- https://developers.cloudflare.com/durable-objects/platform/limits/
- https://developers.cloudflare.com/api/resources/r2/subresources/buckets/
