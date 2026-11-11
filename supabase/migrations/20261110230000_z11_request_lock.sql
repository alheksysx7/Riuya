-- El bloqueo de fila requiere UPDATE; el rol solo puede cambiar el estado propio mediante funciones.
grant update(status) on private.account_deletion_requests to riuya_deletion_user;
