# Turnos Online

Sistema de reservas para centros de estética: los clientes reservan desde el celular o la computadora y el centro gestiona agenda, señas, clientes e ingresos desde un panel.

- **Página pública** (`/`): elegir profesional, tratamiento, día y franja; seña por transferencia con comprobante; "Mis turnos" con link privado; reprogramar, cancelar y lista de espera.
- **Panel del centro** (`/#centro`): agenda semanal y diaria, señas por validar, recordatorios por WhatsApp, lista de espera, ingresos con exportación a Excel, clientes con paquetes y saldo a favor, tratamientos, disponibilidad y ajustes.

## Cómo está armado

| Parte | Qué es |
|---|---|
| `index.html`, `styles.css`, `app.js` | La página. Es estática: se publica en cualquier hosting (Cloudflare Pages, Vercel, Netlify). |
| `config.js` | URL y clave **pública** de Supabase. Es seguro que esté en el navegador: los permisos los controla la base. |
| `supabase/migrations/` | Tablas, reglas de seguridad y funciones. Toda la lógica que importa (que no haya doble reserva, señas, cancelaciones, saldo a favor, paquetes) corre en el servidor. |
| `tests/` | Simulador de Supabase y prueba de la interfaz con Playwright. |

### Seguridad
- Los clientes **no** pueden leer tablas: solo usan funciones que validan su link privado (`#mis-<token>`).
- El personal entra con email y contraseña (Supabase Auth). La tabla `staff` define si es **admin** (ve todo, incluidos ingresos) o **profesional** (ve solo su agenda).
- Los comprobantes se guardan en un bucket privado (`comprobantes`); solo el personal los puede ver, con links temporales.
- Las reservas con seña pendiente se vencen solas cada minuto (`pg_cron`).

## Puesta en marcha

1. **Base de datos**: aplicar las migraciones en orden (`0001` → `0004`) en el proyecto de Supabase.
2. **Auth** (Supabase → Authentication):
   - *Sign In / Providers → Email*: desactivar **"Allow new users to sign up"** (solo el centro crea usuarios).
   - *URL Configuration → Site URL*: la dirección pública de la página.
   - *Users → Add user*: crear cada persona del centro con email y contraseña (marcar *Auto Confirm User*).
3. **Habilitar al personal** (SQL Editor):
   ```sql
   insert into public.staff (user_id, nombre, rol)
   select id, 'Nombre', 'admin' from auth.users where email = 'admin@centro.com';

   -- profesional (ve solo su agenda):
   insert into public.staff (user_id, nombre, rol, profesional_id)
   select u.id, 'Lucía', 'profesional', p.id
   from auth.users u, public.profesionales p
   where u.email = 'lucia@centro.com' and p.nombre = 'Lucía Ferrer';
   ```
4. **Publicar**: conectar este repositorio a Cloudflare Pages (sin comando de build; carpeta de salida `/`).

## Probar la interfaz localmente

```bash
npm i -D playwright
node tests/ui.test.js
```

## Pendiente (paso 3)
- Bot de WhatsApp que manda el link de reserva y recordatorios automáticos (WhatsApp Business Platform).
- Cobro automático con Mercado Pago (hoy la seña es por transferencia con confirmación manual).
