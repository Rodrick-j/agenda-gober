-- NULL mientras un usuario no tiene contraseña asignada todavia (no puede
-- iniciar sesion hasta que se le fije una). Nunca se guarda en texto plano.
ALTER TABLE usuarios ADD COLUMN password_hash text;
